const path = require('path');
const { createApp } = require('../shared/electron-main');

createApp({
  client: 'admin',
  title: 'ClubDojo Admin',
  width: 1600, height: 900, minWidth: 1200, minHeight: 680,
  indexFile: path.join(__dirname, 'index.html'),
});
