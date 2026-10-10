// Servidor estático mínimo para desarrollo: node tools/serve.js [puerto]
// Solo escucha en 127.0.0.1 y solo sirve ficheros de la carpeta del juego.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http
  .createServer(function (req, res) {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    const inside = file.startsWith(ROOT + path.sep);
    const hidden = path.relative(ROOT, file).split(path.sep).some(function (part) {
      return part.startsWith('.');
    });
    if (!inside || hidden) {
      res.writeHead(403).end('Prohibido');
      return;
    }
    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', function () {
    console.log('Esquiva en http://127.0.0.1:' + PORT + '/');
  });
