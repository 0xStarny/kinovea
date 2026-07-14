// Local dev server ONLY. Serves ./ as static and routes /api/kq/* to the same
// handler modules Vercel runs in production, so identical code paths are tested
// locally without the Vercel CLI. Not used in production.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3210;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function collectBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API router: mimic Vercel's (req, res) Node handler contract ---
  if (url.pathname.startsWith('/api/kq/')) {
    const name = url.pathname.replace('/api/kq/', '').replace(/\/$/, '');
    const file = path.join(__dirname, 'api', 'kq', name + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no handler: ' + name); }

    delete require.cache[require.resolve(file)]; // hot-reload during dev
    const handler = require(file);

    req.query = Object.fromEntries(url.searchParams);
    req.body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await collectBody(req);
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    }

    // Minimal Vercel-like res shim
    const shim = {
      _status: 200,
      _headers: {},
      status(code) { this._status = code; return this; },
      setHeader(k, v) { this._headers[k] = v; },
      json(obj) {
        res.writeHead(this._status, { 'Content-Type': 'application/json; charset=utf-8', ...this._headers });
        res.end(JSON.stringify(obj));
      },
      send(text) {
        res.writeHead(this._status, this._headers);
        res.end(typeof text === 'string' ? text : JSON.stringify(text));
      },
      end(text) { res.writeHead(this._status, this._headers); res.end(text || ''); }
    };

    try {
      await handler(req, shim);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'handler_crash', message: e.message }));
    }
    return;
  }

  // --- Static files ---
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/rdv/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';
  // cleanUrls parity: allow /rdv -> /rdv/index.html
  let fp = path.join(__dirname, pathname);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!fs.existsSync(fp)) {
    // try .html extension (cleanUrls)
    if (fs.existsSync(fp + '.html')) fp = fp + '.html';
    else { res.writeHead(404); return res.end('not found: ' + pathname); }
  }

  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, () => console.log(`dev server on http://localhost:${PORT}  (booking UI at /rdv/)`));
