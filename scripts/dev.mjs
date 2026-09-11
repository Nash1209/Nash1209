#!/usr/bin/env node
// ローカル開発サーバー（依存パッケージなし）
//   node scripts/dev.mjs            → http://localhost:3000
//   PORT=8080 node scripts/dev.mjs
// fx-lot-calculator/ を静的配信し、/api/* は api/*.js の Vercel 関数をそのまま呼ぶ。
// .env.local（無ければ .env）を読み込んで process.env に入れる。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STATIC_DIR = join(ROOT, 'fx-lot-calculator');
const API_DIR = join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;

// --- .env ---
for (const name of ['.env.local', '.env']) {
  const file = join(ROOT, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  console.log(`env: loaded ${name}`);
  break;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

// Vercel の (req, res) 関数に合わせた薄いアダプタ
const adapt = (req, res, url) => {
  req.query = Object.fromEntries(url.searchParams.entries());
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  res.send = (body) => { res.end(body); return res; };
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
      const file = join(API_DIR, `${name}.js`);
      if (!existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
      const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); // 編集を毎回反映
      adapt(req, res, url);
      await mod.default(req, res);
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(STATIC_DIR, path));
    if (!file.startsWith(STATIC_DIR)) { res.statusCode = 403; res.end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(file));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(String(e?.stack || e));
  }
});

server.listen(PORT, () => {
  console.log(`FX Lot Calculator dev server: http://localhost:${PORT}`);
  console.log(`  static: ${STATIC_DIR}`);
  console.log(`  api:    /api/quote?pair=USD/JPY, /api/config`);
});
