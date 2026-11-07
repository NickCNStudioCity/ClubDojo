const path = require('path');
const { createApp } = require('../shared/electron-main');

createApp({
  client: 'player',
  title: 'ClubDojo',
  width: 1280, height: 800, minWidth: 960, minHeight: 600,
  indexFile: path.join(__dirname, 'index.html'),
});
