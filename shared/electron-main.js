// Electron shell shared by the player and admin apps: one window, plus LAN discovery
// (listens for the server's UDP beacon and forwards it to the page).
const path = require('path');
const dgram = require('dgram');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { DISCOVERY_PORT } = require('./protocol');
const updater = require('./updater');

const UPDATE_CHECK_MS = 60 * 60 * 1000;

function createApp({ client, title, width, height, minWidth, minHeight, indexFile }) {
  let win = null;
  let udp = null;
  let updating = false;
  // Portable builds: electron-builder sets this to the .exe the player double-clicked.
  const exeFile = process.env.PORTABLE_EXECUTABLE_FILE || null;
  const kind = client === 'admin' ? 'Admin' : 'Player';

  // One update check. A newer build (or a forced reinstall) is downloaded, then the app restarts into it.
  async function updateNow({ force = false, interactive = false } = {}) {
    if (updating) return;
    updating = true;
    try {
      if (!exeFile) {
        if (interactive) dialog.showMessageBox({ message: 'Updates only work in the packaged .exe, not when running from source.' });
        return;
      }
      const r = await updater.checkForUpdate({
        kind, target: exeFile, force, stateFile: path.join(app.getPath('userData'), 'update-state.json'),
        log: (m) => console.log(`[update] ${m}`),
      });
      if (r.status === 'staged') { updater.applyUpdate(r); app.quit(); return; }
      if (interactive) {
        dialog.showMessageBox({ message: r.status === 'no-release' ? 'No ClubDojo release was found on GitHub.' : 'You already have the latest version.' });
      }
    } catch (e) {
      console.log(`[update] ${e.message}`);
      if (interactive) dialog.showErrorBox('Update failed', e.message);
    } finally {
      updating = false;
    }
  }

  function startDiscovery() {
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', () => { try { udp.close(); } catch {} udp = null; });
    udp.on('message', (buf, rinfo) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.app !== 'clubdojo' || !win || win.isDestroyed()) return;
      win.webContents.send('clubdojo:discover', {
        name: String(m.name || 'ClubDojo').slice(0, 40), address: rinfo.address, port: Number(m.port) || 7777,
        online: Number(m.online) || 0, max: Number(m.max) || 30,
      });
    });
    udp.bind(DISCOVERY_PORT);
  }

  function createWindow() {
    win = new BrowserWindow({
      width, height, minWidth, minHeight, title, backgroundColor: '#cfe9f5', show: false, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'electron-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    win.once('ready-to-show', () => win.show());
    win.loadFile(indexFile);
    // Never navigate away from the game or open popups; external links go to the system browser.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => { win = null; });
  }

  app.whenReady().then(() => {
    // The menu bar stays hidden; press Alt to show it.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Updates', submenu: [
        { label: 'Check for updates', click: () => updateNow({ interactive: true }) },
        { label: 'Reinstall latest version', click: () => updateNow({ force: true, interactive: true }) },
      ] },
    ]));
    startDiscovery();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    setTimeout(() => updateNow(), 3000);
    setInterval(() => updateNow(), UPDATE_CHECK_MS);
  });
  app.on('window-all-closed', () => {
    if (udp) try { udp.close(); } catch {}
    app.quit();
  });
}

module.exports = { createApp };
