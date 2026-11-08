// Builds the three release files into dist/:
//   ClubDojo-Server-<v>.exe   standalone world server (Node single executable, no install)
//   ClubDojo-Player-<v>.exe   portable player client (Electron)
//   ClubDojo-Admin-<v>.exe    portable admin client (Electron)
// Run: npm run release   (Windows; downloads Electron and NSIS build tools on first run)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const buildDir = path.join(root, 'build');
const distDir = path.join(root, 'dist');
const electronVersion = require('electron/package.json').version;

function clean(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
function copy(from, to) { fs.cpSync(path.join(root, from), to, { recursive: true }); }
function step(msg) { console.log(`\n== ${msg}`); }

async function buildServer() {
  step('Server: bundling');
  const out = path.join(buildDir, 'server');
  fs.mkdirSync(out, { recursive: true });
  const entry = path.join(out, 'entry.js');
  fs.writeFileSync(entry, `require(${JSON.stringify(path.join(root, 'server/src/index.js'))}).runCli();\n`);
  await require('esbuild').build({
    entryPoints: [entry], bundle: true, platform: 'node', target: 'node22', format: 'cjs',
    outfile: path.join(out, 'server.cjs'),
    external: ['bufferutil', 'utf-8-validate'], // optional speedups for ws; it works without them
    logLevel: 'warning',
  });

  step('Server: making single executable');
  const seaConfig = path.join(out, 'sea-config.json');
  const blob = path.join(out, 'sea-prep.blob');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: path.join(out, 'server.cjs'), output: blob,
    disableExperimentalSEAWarning: true, useCodeCache: false,
    execArgv: ['--no-warnings=ExperimentalWarning'],
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
  const exe = path.join(distDir, `ClubDojo-Server-${version}.exe`);
  fs.copyFileSync(process.execPath, exe);
  execFileSync(process.execPath, [require.resolve('postject/dist/cli.js'), exe, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
  return exe;
}

async function buildClient(kind) {
  const isAdmin = kind === 'admin';
  const productName = isAdmin ? 'ClubDojo Admin' : 'ClubDojo';
  const artifact = `ClubDojo-${isAdmin ? 'Admin' : 'Player'}-${version}.exe`;
  step(`${productName}: staging`);
  // Mirror the repo layout so the ../shared paths in the app work unchanged.
  const stage = path.join(buildDir, `${kind}-app`);
  clean(stage);
  for (const f of fs.readdirSync(path.join(root, `${kind}-client`))) {
    if (f === 'package.json' || f === 'node_modules') continue;
    copy(`${kind}-client/${f}`, path.join(stage, `${kind}-client`, f));
  }
  for (const f of ['protocol.js', 'updater.js', 'electron-main.js', 'electron-preload.js', 'client', 'cards']) copy(`shared/${f}`, path.join(stage, 'shared', f));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: `clubdojo-${kind}`, productName, version, main: `${kind}-client/main.js`,
    description: isAdmin ? 'ClubDojo admin client' : 'ClubDojo player client', author: 'ClubDojo',
  }, null, 2));

  step(`${productName}: packaging portable exe`);
  const out = path.join(buildDir, `${kind}-out`);
  clean(out);
  await require('electron-builder').build({
    projectDir: stage,
    win: ['portable'],
    publish: 'never',
    config: {
      appId: `local.clubdojo.${kind}`,
      productName,
      electronVersion,
      npmRebuild: false,
      publish: null,
      directories: { output: out },
      files: ['**/*'],
      win: { signAndEditExecutable: false },
      portable: { artifactName: artifact },
    },
  });
  const dest = path.join(distDir, artifact);
  fs.copyFileSync(path.join(out, artifact), dest);
  return dest;
}

(async () => {
  if (process.platform !== 'win32') console.warn('Note: this script is set up for Windows builds.');
  clean(buildDir);
  clean(distDir);
  const files = [await buildServer(), await buildClient('player'), await buildClient('admin')];
  step('Done');
  for (const f of files) console.log(`  ${path.relative(root, f)}  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
})().catch((e) => { console.error(e); process.exit(1); });
