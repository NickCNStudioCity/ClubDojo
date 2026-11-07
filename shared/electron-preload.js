// Bridges the few host features the page needs. No Node access is exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clubdojoHost', {
  onDiscover(cb) {
    ipcRenderer.on('clubdojo:discover', (_e, server) => cb(server));
  },
});
