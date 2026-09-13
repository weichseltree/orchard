import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { overlapArea, parseHeaderRules, resourceSummary, startStaticServer } from './quality-browser-support.mjs';

test('cache hits contribute decoded bytes without inventing network bytes', () => {
  const report = resourceSummary([
    { name: 'http://localhost/assets/a.js', transferSize: 500, encodedBodySize: 200, decodedBodySize: 600 },
    { name: 'http://localhost/assets/b.js', transferSize: 0, encodedBodySize: 100, decodedBodySize: 300 },
    { name: 'https://external.test/c.js', transferSize: 99999, encodedBodySize: 99999, decodedBodySize: 99999 },
  ], 'http://localhost');
  assert.equal(report.completedRequests, 2);
  assert.equal(report.transferBytes, 500);
  assert.equal(report.encodedBodyBytes, 300);
  assert.equal(report.decodedBodyBytes, 900);
  assert.equal(report.cacheHits, 1);
  assert.equal(report.largestResponses[0].path, '/assets/a.js');
});

test('touch-control overlap includes partial intersections but not adjacent controls', () => {
  const stick = { x: 10, y: 10, right: 40, bottom: 40 };
  assert.equal(overlapArea(stick, { x: 30, y: 30, right: 70, bottom: 70 }), 100);
  assert.equal(overlapArea(stick, { x: 40, y: 10, right: 70, bottom: 40 }), 0);
  assert.equal(overlapArea(stick, null), 0);
});

test('Pages headers keep a colon inside CSP or policy values', () => {
  const rules = parseHeaderRules("# comment\n/*\n  Content-Security-Policy: default-src https://example.test\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  assert.equal(rules[0].headers['Content-Security-Policy'], 'default-src https://example.test');
  assert.match(rules[1].headers['Cache-Control'], /immutable/);
});

test('the local build server preserves cache/CSP headers and explicit gzip encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grove-quality-server-'));
  let server;
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
    await writeFile(join(root, 'index.html'), '<main>Hello</main>');
    await writeFile(join(root, 'assets', 'a.js'), 'export const x=1;'.repeat(100));
    server = await startStaticServer(root, { gzip: true });
    const response = await fetch(`${server.url}/assets/a.js`);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal((await response.text()).length, 1700);
    assert.equal((await fetch(`${server.url}/auth`)).status, 503);
    assert.equal((await fetch(`${server.url}/missing.js`)).status, 404);
  } finally {
    if (server) await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
