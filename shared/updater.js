// Auto-updater shared by the World Server and both Electron clients (Windows portable .exe builds).
// It reads the latest GitHub release, finds the ClubDojo-<Kind>-*.exe asset and compares it with the
// file that is running, by SHA-256 when GitHub reports a digest. So a file re-uploaded under the same
// tag counts as an update. Nothing here runs from source: callers only use it for packaged builds.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_REPO = 'NickCNStudioCity/ClubDojo';
const UA = 'ClubDojo-Updater';

// Latest non-draft, non-prerelease release. Returns null when none has a matching .exe.
async function fetchLatest({ repo = DEFAULT_REPO, prefix, timeoutMs = 15000 }) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null; // no release published yet
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = await res.json();
  const a = (release.assets || []).find((x) => x.name.startsWith(prefix) && x.name.toLowerCase().endsWith('.exe'));
  if (!a) return null;
  return {
    tag: release.tag_name,
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
    updatedAt: a.updated_at,
    digest: a.digest ? a.digest.replace(/^sha256:/, '') : null,
  };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function readState(stateFile) {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
}

function writeState(stateFile, asset) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ build: buildKey(asset), name: asset.name, tag: asset.tag }, null, 2));
  } catch {}
}

// Fallback identity for releases whose assets carry no digest.
function buildKey(asset) { return `${asset.name}|${asset.updatedAt}|${asset.size}`; }

async function isOutdated(asset, target, stateFile) {
  if (asset.digest) return (await sha256File(target)) !== asset.digest;
  return readState(stateFile).build !== buildKey(asset);
}

// Downloads the asset to newFile and checks it against the size and digest GitHub reported.
async function download(asset, newFile) {
  const res = await fetch(asset.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== asset.size) throw new Error(`download incomplete (${buf.length} of ${asset.size} bytes)`);
  if (asset.digest && crypto.createHash('sha256').update(buf).digest('hex') !== asset.digest) {
    throw new Error('download failed the checksum');
  }
  fs.writeFileSync(newFile, buf);
}

// Checks for a newer build of this app and downloads it beside the running file.
// Returns { status: 'no-release' }, { status: 'current', asset } or
// { status: 'staged', asset, newFile, dest, target }. Call applyUpdate() to swap it in.
// force: true downloads the latest asset even when it matches the running file (reinstall).
async function checkForUpdate({ kind, target, repo = DEFAULT_REPO, stateFile, force = false, log = () => {} }) {
  const asset = await fetchLatest({ repo, prefix: `ClubDojo-${kind}-` });
  if (!asset) return { status: 'no-release' };
  if (!force && !(await isOutdated(asset, target, stateFile))) return { status: 'current', asset };

  const dir = path.dirname(target);
  fs.accessSync(dir, fs.constants.W_OK); // fail early if the folder is read-only
  const newFile = path.join(dir, `.${asset.name}.download`);
  const dest = path.join(dir, asset.name);
  log(`Downloading ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)...`);
  await download(asset, newFile);
  writeState(stateFile, asset);
  return { status: 'staged', asset, newFile, dest, target };
}

// Starts a hidden Windows script that waits for this process to exit, moves the new file over
// the old one (retrying while Windows still holds it), and starts it again unless relaunch is false.
// The caller must quit next.
// The wait loop writes tasklist's output to a file instead of piping it into find: in the spawned
// script that pipe never closed, so find waited forever and the update never installed. It also
// gives up waiting after about two minutes and lets the move loop take over.
function applyUpdate(staged, { args = [], relaunch = true } = {}) {
  const { newFile, dest, target } = staged;
  const log = path.join(os.tmpdir(), 'clubdojo-update.log');
  const launchArgs = args.map((a) => `"${a}"`).join(' ');
  const base = path.join(os.tmpdir(), `clubdojo-update-${process.pid}-${Date.now()}`);
  const script = `${base}.cmd`;
  const check = `${base}.txt`;
  fs.writeFileSync(script, [
    '@echo off',
    `set "PID=${process.pid}"`,
    'set /a WAITS=0',
    ':waitexit',
    'set /a WAITS+=1',
    `tasklist /FI "PID eq %PID%" /NH /FO CSV >"${check}" 2>nul`,
    // CSV rows look like "ClubDojo.exe","1996",... so match the quoted PID exactly.
    `"%SystemRoot%\\System32\\find.exe" ",""%PID%""," "${check}" >nul 2>&1`,
    'if not errorlevel 1 if %WAITS% LSS 120 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto waitexit',
    ')',
    `del /F /Q "${check}" >nul 2>&1`,
    'set /a TRIES=0',
    ':move',
    'set /a TRIES+=1',
    `move /Y "${newFile}" "${dest}" >nul 2>&1`,
    'if errorlevel 1 (',
    '  if %TRIES% GEQ 60 (',
    `    echo Could not replace "${dest}">>"${log}"`,
    '    goto end',
    '  )',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto move',
    ')',
    `if /i not "${target}"=="${dest}" del /F /Q "${target}" >nul 2>&1`,
    ...(relaunch ? [`start "" "${dest}" ${launchArgs}`] : []),
    ':end',
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n'));
  // A detached cmd.exe has no console, so every tasklist, find and ping it ran opened a window of
  // its own. wscript (no console) starts cmd in one hidden console instead, then exits.
  // Without Windows Script Host it falls back to the detached cmd (works, just with windows).
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  if (fs.existsSync(wscript)) {
    const launcher = `${base}.vbs`;
    // UTF-16 with a BOM so wscript reads paths with non-ASCII characters (user names) correctly.
    fs.writeFileSync(launcher, '\ufeff' + [
      `CreateObject("WScript.Shell").Run "cmd.exe /d /c """"${script}""""", 0, False`,
      'CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName',
      '',
    ].join('\r\n'), 'utf16le');
    spawn(wscript, ['//B', '//Nologo', launcher], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

module.exports = { DEFAULT_REPO, fetchLatest, checkForUpdate, applyUpdate, sha256File };
