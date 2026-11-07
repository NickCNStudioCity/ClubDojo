// Dev only: serves the repo over http://localhost:5173 so the client pages can be opened in a
// browser for quick UI testing (e.g. /player-client/index.html). The real apps run in Electron.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 5173);

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'player-client/index.html' : url);
  if (!file.startsWith(root) || file.includes('node_modules') || file.includes(`${path.sep}data${path.sep}`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log(`Dev web: http://localhost:${port}/player-client/index.html and /admin-client/index.html`));
