// Dev only: runs a world server with a throwaway world for browser testing, next to dev-web.js.
// Join code DEV123; admin login admin / devadmin. The world is kept in the OS temp folder
// (clubdojo-dev) so it survives restarts; delete that folder to start fresh.
const os = require('os');
const path = require('path');
const { start } = require('../server/src/index');

const server = start({
  port: Number(process.env.CLUBDOJO_PORT || 7777),
  dataDir: process.env.CLUBDOJO_DATA || path.join(os.tmpdir(), 'clubdojo-dev'),
  joinCode: 'DEV123',
  adminPassword: 'devadmin',
  discovery: false,
});
server.ready.then(() => console.log('Dev server ready: localhost:7777, join code DEV123'));
