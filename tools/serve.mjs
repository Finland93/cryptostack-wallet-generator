#!/usr/bin/env node
/**
 * serve.mjs — a static file server for looking at the build locally.
 *
 * You do not need this to use the tool. Every page is one self-contained file
 * and opens straight from a folder — that is the whole design, and it is what
 * most people should do.
 *
 * This exists to check the *hosted* path before pushing: that Pages will serve
 * the pages with the right content type, that the CSP behaves over http, and
 * that the search threads get real Workers. Rare enough to be worth a script
 * and not worth a dependency.
 *
 * It binds to 127.0.0.1 on purpose. This is a tool that puts private keys on
 * screen; it has no business being reachable from the rest of your network.
 *
 * Usage: node tools/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;
const HOST = '127.0.0.1';

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
  }),
);

/** Resolve a request path to a file inside ROOT, or null if it escapes. */
async function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(ROOT, '.' + path.posix.normalize(decoded));

  // path.resolve on "../../etc/passwd" would happily leave ROOT. Refuse.
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;

  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const index = path.join(target, 'index.html');
      await fs.access(index);
      return index;
    }
    return target;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed\n');
    return;
  }

  const target = await resolveTarget(req.url ?? '/');
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found\n');
    return;
  }

  try {
    const body = await fs.readFile(target);
    res.writeHead(200, {
      'content-type': TYPES.get(path.extname(target)) ?? 'application/octet-stream',
      'content-length': body.length,
      // No caching: you are here to see the file you just built, not the one
      // the browser remembers from the last build.
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error\n');
    console.error(err);
  }
});

server.listen(PORT, HOST, async () => {
  const built = await fs
    .access(path.join(ROOT, 'index.html'))
    .then(() => true)
    .catch(() => false);

  console.log(`\n  cryptostack  →  http://${HOST}:${PORT}/`);
  if (!built) {
    console.log('\n  ! index.html is missing. Run `npm run build` first.');
  }
  console.log('\n  Ctrl-C to stop.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is busy. Try: node tools/serve.mjs ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});
