const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

http.createServer((req, res) => {
  const requestedPath = req.url.split('?')[0];
  const pathname = requestedPath === '/' ? 'index.html' : decodeURIComponent(requestedPath).replace(/^\/+/, '');
  const target = path.resolve(root, pathname);
  if (!target.startsWith(root) || target.startsWith(path.join(root, 'data'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(target, (error, file) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream' });
    res.end(file);
  });
}).listen(4173, '127.0.0.1', () => {
  console.log('TB static dev server is ready at http://127.0.0.1:4173');
});
