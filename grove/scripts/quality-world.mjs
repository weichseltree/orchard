#!/usr/bin/env node
/**
 * Every Observatory room, from a real browser camera. Synthetic media only;
 * no accounts, live exhibits or external requests. PNGs are unedited captures.
 * pnpm quality:world --out ../results/observatory/world.json --screenshots
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const grove = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: {
  out: { type: 'string', default: '../results/quality/world.json' },
  screenshots: { type: 'boolean', default: false },
  'base-url': { type: 'string' },
} });
const output = resolve(grove, args.out);
const shotDir = output.replace(/\.json$/, '') + '-screenshots';
const stations = [
  ['hall', 0, 9, 0, 12],
  ['einstruct', 12, -5, -90, 5],
  ['phototroph', 0, 14, 180, -8],
  ['world-engine', 0, -14, 0, 5],
  ['orangery', 0, -36, 0, 12],
  ['stair-north', -13, -80, 90, 6],
  ['foyer', -15, -41, -90, 3],
  ['club', 0, -20, 0, 4],
  ['stage', 2.2, -74.5, 180, 4],
  ['gallery', 0, 33, 180, 12],
  ['belvedere', 0, 70, 0, -3],
  ['greenhouse', 11.5, 8, -90, 8],
  ['terrace', -15, 10, 90, 5],
  ['parterre', -26, 0, 90, 4],
  ['orchard-west', -45, -60, 0, 5],
  ['orchard-south', -80, 0, 90, 5],
  ['orchard-east', -45, 60, 180, 5],
  ['orrery', 0, -400, 0, 8],
];
const report = {
  schema: 'orchard/observatory-quality/1', measuredAt: new Date().toISOString(),
  limits: [
    'Local Chromium with SwiftShader. No physical-device performance claim.',
    'All room shells are loaded before camera checks; rendering counts are per captured view.',
    'Media are synthetic local playback fixtures and are not research evidence.',
    'Architecture captures hide the HTML controls. Capture dimensions are native, without upscaling.',
    'Playback is stopped after loading and each camera view is rendered once for deterministic architecture inspection.',
    'The closed Workshop is inspected directly; it is not offered as a visitor doorway.',
  ],
  checks: [], stations: [], errors: [],
};
const check = (name, pass, details) => report.checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
let server, browser;
try {
  await mkdir(dirname(output), { recursive: true });
  if (args.screenshots) await mkdir(shotDir, { recursive: true });
  let base = args['base-url'];
  if (!base) {
    execFileSync('pnpm', ['run', 'dev:bundle'], { cwd: grove, stdio: 'pipe' });
    const { createServer } = await import('vite');
    server = await createServer({ root: grove, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
    await server.listen();
    base = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Use a local HTTP server.');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  await context.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(origin.origin + '/') || /^(data:|blob:)/.test(url) ? route.continue() : route.abort();
  });
  const events = { errors: [], external: [], legacy: [], decoderCode: [] };
  page.on('pageerror', (error) => events.errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') events.errors.push(message.text()); });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin.origin + '/') && !/^(data:|blob:)/.test(url)) events.external.push(url);
    if (/\/assets\/.*\.(glb|ktx2|png)(\?|$)|basis_transcoder/.test(url)) events.legacy.push(url);
    if (/GLTFLoader|KTX2Loader|\/src\/(?:world\/rooms|render\/lightmap)\.ts(?:\?|$)/.test(url)) events.decoderCode.push(url);
  });
  await page.addInitScript(() => localStorage.setItem('orchard.grove.guide-seen', '1'));
  await page.goto(`${origin.origin}/mind/?demo&room=hall`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.grove?.world?.group?.getObjectByName('hall-shell'), null, { timeout: 60000 });
  await page.evaluate(async () => {
    const app = window.grove;
    await app.world.ensureRooms(app.mansion.rooms.map((room) => room.id));
  });
  await page.addStyleTag({ content: '#hud, #boot-status { visibility: hidden !important; }' });
  const world = await page.evaluate(() => {
    const app = window.grove;
    let batches = 0, instances = 0;
    const rooms = app.mansion.rooms.map((room) => {
      const shell = app.world.group.getObjectByName(`${room.id}-shell`);
      shell?.traverse((node) => {
        if (node.isMesh) batches++;
        if (node.isInstancedMesh) instances += node.count;
      });
      return { id: room.id, architecture: shell?.userData.architecture ?? null };
    });
    return { rooms, batches, instances, tapes: app.world.tapes.filter(Boolean).length };
  });
  report.world = world;
  check('All 37 rooms use runtime architecture (36 Observatory, the Orrery in space)', world.rooms.length === 37
    && world.rooms.filter((room) => room.architecture === 'observatory').length === 36
    && world.rooms.filter((room) => room.architecture === 'space').length === 1, world.rooms);
  check('Architecture stays near fifteen draw batches a room across the whole world', world.batches < world.rooms.length * 16, world.batches);
  // Six tapes: einstruct's two sheets, phototroph's capture, and arcedit's three
  // (two episodes and the canvas). spectre's worlds are a planet hanging (no
  // fixture in the demo), and the terrace's moon is gone.
  check('Synthetic playback fixtures loaded', world.tapes === 6, world.tapes);
  await page.evaluate(() => {
    window.grove.view.renderer.setAnimationLoop(null);
    for (const video of document.querySelectorAll('video')) video.pause();
    for (const tape of window.grove.world.tapes.filter(Boolean)) {
      tape.setPlaying(false);
      tape.scrubToFraction(0.35);
      tape.update(0);
    }
  });
  await page.waitForFunction(() => window.grove.world.tapes.filter(Boolean).every((tape) => {
    tape.update(0);
    return !tape.waiting && tape.stream.residentCount > 0;
  }), null, { timeout: 30000 });
  check('Every fixture has uploaded a source frame before capture', true);
  for (const [room, x, z, yaw, pitch] of stations) {
    await page.evaluate(({ room, x, z, yaw, pitch }) => {
      const app = window.grove, yawRad = yaw * Math.PI / 180, pitchRad = pitch * Math.PI / 180;
      // The camera stands on the room's own floor: rooms are at different heights, and the club is under the wing.
      const floor = app.mansion.rooms.find((r) => r.id === room).bounds.min[1];
      Object.assign(app.body, { room, x, y: floor, z, yaw: yawRad, pitch: pitchRad });
      app.view.rig.position.set(x, floor, z);
      app.view.rig.rotation.y = yawRad;
      app.view.camera.rotation.set(pitchRad, 0, 0);
      app.view.renderer.render(app.view.scene, app.view.camera);
    }, { room, x, z, yaw, pitch });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const metrics = await page.evaluate(() => window.grove.metrics());
    const station = { room, camera: { x, z, eyeHeight: 1.6, floor: true, yaw, pitch }, rendering: metrics.rendering };
    check(`${room}: rendered a nonempty scene`, metrics.rendering.calls > 0 && metrics.rendering.triangles > 0);
    if (args.screenshots) {
      const file = resolve(shotDir, `${room}.png`);
      await page.screenshot({ path: file });
      station.screenshot = { file, width: 1600, height: 900, sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
    }
    report.stations.push(station);
  }
  check('No legacy palace or lightmap downloads', events.legacy.length === 0, events.legacy);
  check('No legacy GLTF or KTX2 decoder code downloads', events.decoderCode.length === 0, events.decoderCode);
  check('No external requests', events.external.length === 0, events.external);
  check('No JavaScript or console errors', events.errors.length === 0, events.errors);
  report.browser = browser.version();
} catch (error) {
  report.errors.push(error?.stack ?? String(error));
} finally {
  try { await browser?.close(); } catch (error) { report.errors.push(String(error)); }
  try { await server?.close(); } catch (error) { report.errors.push(String(error)); }
  report.summary = { checks: report.checks.length, passed: report.checks.filter((item) => item.pass).length, failed: report.checks.filter((item) => !item.pass).length, errors: report.errors.length };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...report.summary }));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
