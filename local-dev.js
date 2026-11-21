// Serveur de développement local uniquement (sur Vercel, public/ et api/index.js sont servis directement)
const http = require('http');
const fs = require('fs');
const path = require('path');
const apiHandler = require('./api/index.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/api/')) {
    return apiHandler(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    if (pathname !== '/' && fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return serveStaticFile(res, fullPath);
    }
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }

  res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`WordCloud local dev server running on http://localhost:${PORT}`);
  });
}

module.exports = apiHandler;

