// Electron shell shared by the player and admin apps: one window, plus LAN discovery
// (listens for the server's UDP beacon and forwards it to the page).
const path = require('path');
const dgram = require('dgram');
const { app, BrowserWindow, Menu, shell } = require('electron');
const { DISCOVERY_PORT } = require('./protocol');

function createApp({ client, title, width, height, minWidth, minHeight, indexFile }) {
  let win = null;
  let udp = null;

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
    Menu.setApplicationMenu(null);
    startDiscovery();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => {
    if (udp) try { udp.close(); } catch {}
    app.quit();
  });
}

module.exports = { createApp };
