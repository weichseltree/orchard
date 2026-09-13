import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Resource Timing distinguishes downloaded bodies from decoded cache entries. */
export function resourceSummary(entries, origin) {
  const local = entries.filter((entry) => entry.name.startsWith(`${origin}/`));
  const sum = (key) => local.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  return {
    completedRequests: local.length,
    transferBytes: sum('transferSize'),
    encodedBodyBytes: sum('encodedBodySize'),
    decodedBodyBytes: sum('decodedBodySize'),
    cacheHits: local.filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0).length,
    largestResponses: local.filter((entry) => entry.encodedBodySize > 0)
      .sort((a, b) => b.encodedBodySize - a.encodedBodySize).slice(0, 8)
      .map(({ name, transferSize, encodedBodySize, decodedBodySize }) => ({
        path: new URL(name).pathname, transferSize, encodedBodySize, decodedBodySize,
      })),
  };
}

/** Pairs are audited geometrically, including partial overlaps at narrow widths. */
export function overlapArea(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
}

export function compactAxe(result) {
  const compact = (rules) => rules.map(({ id, impact, help, helpUrl, nodes }) => ({
    id, impact, help, helpUrl,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  return {
    rulesPassed: result.passes.length,
    violations: compact(result.violations),
    needsManualReview: compact(result.incomplete),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif',
  '.webp': 'image/webp', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
};

/** Apply the checked-in Pages header rules without adding cloud credentials. */
export function parseHeaderRules(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else if (rules.length > 0) {
      const at = line.indexOf(':');
      if (at > 0) rules.at(-1).headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return rules;
}

export async function startStaticServer(directory, { gzip = false } = {}) {
  const root = resolve(directory);
  const rules = parseHeaderRules(await readFile(resolve(root, '_headers'), 'utf8'));
  const cache = new Map();
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path === '/auth' || path.startsWith('/auth/')) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end('{"error":"External services are unavailable in this local audit"}');
        return;
      }
      let file = resolve(root, `.${path}`);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403); response.end(); return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      let body = cache.get(file);
      if (!body) { body = await readFile(file); cache.set(file, body); }
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
      for (const rule of rules) {
        if (rule.path.endsWith('*') ? path.startsWith(rule.path.slice(0, -1)) : path === rule.path) {
          Object.assign(headers, rule.headers);
        }
      }
      // This opt-in is a local gzip transport model, not a claim about the CDN.
      if (gzip && /text\/|javascript|json|svg|wasm/.test(type) && /gzip/.test(request.headers['accept-encoding'] ?? '')) {
        body = gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
      }
      headers['Content-Length'] = body.length;
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500);
      response.end('Not available in this local build');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((accept) => { server.closeAllConnections(); server.close(accept); }),
  };
}
