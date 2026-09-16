#!/usr/bin/env node
/**
 * Local browser checks and measurements, with no production credentials.
 *
 *   pnpm quality:browser
 *   pnpm quality:browser --base-url http://127.0.0.1:5173 --out ../results/quality/dev.json
 *   pnpm quality:browser --dist dist --out ../results/quality/production.json
 *
 * Default: generate synthetic fixtures and start an ephemeral local Vite.
 * --dist: serve an existing production build with its Pages headers, measure
 * desktop/phone cold and warm visits, and block external services. This is
 * local transport and software-rendering evidence, not a hardware/CDN test.
 * Browser installation: pnpm exec playwright install chromium
 * --allow-missing-metrics is only for auditing a baseline before grove.metrics.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { compactAxe, overlapArea, resourceSummary, startStaticServer } from './quality-browser-support.mjs';

const grove = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: {
  'base-url': { type: 'string' }, dist: { type: 'string' }, out: { type: 'string', default: '../results/quality/browser.json' },
  label: { type: 'string', default: 'working-tree' }, executable: { type: 'string' },
  gzip: { type: 'boolean', default: false }, 'record-only': { type: 'boolean', default: false },
  'allow-missing-metrics': { type: 'boolean', default: false },
  screenshots: { type: 'boolean', default: false },
  scope: { type: 'string', default: 'all' }, samples: { type: 'string', default: '1' },
} });
if (args.dist && args['base-url']) throw new Error('Choose --dist or --base-url, not both.');
if (!['all', 'landing', 'app', 'transfer', 'memory'].includes(args.scope)) throw new Error('scope must be all, landing, app, transfer or memory');
if (args.dist && ['app', 'memory'].includes(args.scope)) throw new Error('--scope app and memory need the development demo; use --scope all or transfer for a production build.');
const samples = Number(args.samples);
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error('samples must be an integer from 1 to 10');
const output = resolve(grove, args.out);
await mkdir(dirname(output), { recursive: true });
let ownedServer;
let browser;
const report = {
  schema: 'orchard/browser-quality/1', label: args.label, measuredAt: new Date().toISOString(),
  environment: {}, measurements: [], checks: [], errors: [],
  limits: [
    'Chromium headless with SwiftShader; touch is emulated, not physical-device validation.',
    'Axe detects some accessibility issues; incomplete rules remain explicit manual-review findings.',
    'Resource Timing transferSize includes browser header accounting; it is not a packet capture.',
    'Decoded/encoded body sizes include cached resources; transferBytes reports network accounting separately.',
    'Production mode blocks external authentication, presence and media; it validates local build geometry only.',
    'The static server models identity or gzip and cache policy headers, not CDN Brotli or conditional 304 responses.',
    'Readiness is observed when the start room architecture enters the scene; it is not GPU completion.',
    'App resource snapshots use a 1.5 s observation window after first room readiness; later streaming is not included.',
    'Frame times are SwiftShader software rendering on a CI runner. They are recorded against the 72 Hz budget (13.8 ms p95) but never enforced here: a pass would not prove a Quest holds it, and a fail would measure the runner.',
    'The room tour counts renderer-owned geometries, textures and programs. It finds GPU objects the page keeps creating; it cannot see a leak in plain JavaScript memory.',
  ],
};
const profiles = [
  { name: 'desktop', width: 1440, height: 1000, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small-phone', width: 320, height: 780, touch: true },
  { name: 'phone-landscape', width: 844, height: 390, touch: true },
];
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36';
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const check = (name, pass, details = undefined) => report.checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
const packageManager = process.env.npm_execpath;

function runPackageScript(name) {
  if (!packageManager) throw new Error('quality:browser must be run through pnpm');
  // `npm_execpath` is a JavaScript entry point when pnpm came from npm (as in
  // CI), and a native executable when it came from pnpm's standalone installer
  // (`pnpm-exe`). Handing the native one to node fails with a SyntaxError on
  // the ELF header, so run it directly.
  const script = /\.(c|m)?js$/.test(packageManager);
  execFileSync(script ? process.execPath : packageManager, [...(script ? [packageManager] : []), 'run', name], { cwd: grove, stdio: 'pipe' });
}

async function screenshot(page, name, fullPage = false) {
  if (!args.screenshots) return;
  const directory = output.replace(/\.json$/, '') + '-screenshots';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage });
}

async function newPage(profile, { disableGraphics = false, gameFixture = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    isMobile: profile.touch, hasTouch: profile.touch, deviceScaleFactor: 1,
    ...(profile.touch ? { userAgent: android } : {}), serviceWorkers: 'block',
  });
  const page = await context.newPage();
  if (gameFixture) {
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('https://ftlchess.com/')) {
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>FTL Chess fixture</title><button id="start">Start game</button><script>
            parent.postMessage({ source: 'ftlchess', event: 'ready', platform: 'orchard', payload: {} }, new URL(location.href).searchParams.get('parentOrigin'));
            document.querySelector('#start').onclick = () => {
              parent.postMessage({ source: 'ftlchess', event: 'game-started', platform: 'orchard', payload: { mode: 'fixture' } }, new URL(location.href).searchParams.get('parentOrigin'));
              parent.postMessage({ source: 'ftlchess', event: 'game-ended', platform: 'orchard', payload: { status: 'finished', moves: 1 } }, new URL(location.href).searchParams.get('parentOrigin'));
            };
          </script>`,
        });
      } else if (/^(https:|wss:)/.test(url)) {
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (!gameFixture) await cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'wss://*'] });
  // Do not use context.route: Playwright then disables HTTP caching, invalidating warm visits.
  const events = { pageErrors: [], consoleErrors: [], externalRequests: [], externalSockets: [] };
  page.on('pageerror', (error) => events.pageErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') events.consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('request', (request) => { if (!request.url().startsWith(`${base}/`) && !/^(data:|blob:)/.test(request.url())) events.externalRequests.push(request.url()); });
  page.on('websocket', (socket) => { if (!socket.url().startsWith(base.replace('http:', 'ws:'))) events.externalSockets.push(socket.url()); });
  await page.addInitScript(({ disableGraphics }) => {
    performance.setResourceTimingBufferSize(3000);
    window.__quality = { firstRoomReadyMs: null, shellKind: null };
    if (disableGraphics) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /^webgl/.test(type) ? null : original.call(this, type, ...rest);
      };
      return;
    }
    const inspect = () => {
      const app = window.grove;
      const id = app?.body?.room;
      if (id && app.world?.group?.getObjectByName(`${id}-glb`)) {
        window.__quality.firstRoomReadyMs = performance.now();
        window.__quality.shellKind = 'glb';
      } else if (id && app.world?.group?.getObjectByName(`${id}-shell`)) {
        window.__quality.firstRoomReadyMs = performance.now();
        window.__quality.shellKind = app.world.group.getObjectByName(`${id}-shell`).userData.architecture === 'observatory'
          ? 'observatory' : 'fallback';
      } else requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  }, { disableGraphics });
  return { context, page, events };
}

async function snapshot(page) {
  const raw = await page.evaluate(() => ({
    entries: [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].map((entry) => entry.toJSON()),
    firstRoomReadyMs: window.__quality?.firstRoomReadyMs ?? null,
    shellKind: window.__quality?.shellKind ?? null,
    firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    observedAtMs: performance.now(),
    loadedRoomCount: window.grove?.world?.group?.children.filter((child) => /-(glb|shell)$/.test(child.name)).length ?? null,
    runtime: typeof window.grove?.metrics === 'function' ? window.grove.metrics() : null,
  }));
  const { entries, ...timing } = raw;
  return { ...resourceSummary(entries, base), ...timing };
}

async function ready(page, path) {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (path.startsWith('/mind/')) {
    await page.waitForFunction(() => Number.isFinite(window.__quality?.firstRoomReadyMs), null, { timeout: 60000 });
    // A fixed observation window makes before/after request counts comparable.
    await page.waitForTimeout(1500);
  } else {
    await page.locator('img[fetchpriority=high]').evaluate((image) => image.decode());
    await page.waitForTimeout(250);
  }
}

async function transferAudit() {
  for (const profile of profiles.slice(0, 2)) {
    for (const path of ['/', args.dist ? '/mind/?nosw' : '/mind/?demo']) {
      for (let sample = 1; sample <= samples; sample++) {
        const { context, page } = await newPage(profile);
        try {
          for (const cache of ['cold', 'warm']) {
            await ready(page, path);
            const measured = await snapshot(page);
            report.measurements.push({ kind: 'transfer', profile: profile.name, path, sample, cache, ...measured });
            if (path.startsWith('/mind/')) {
              const name = `${profile.name} ${cache} visit ${sample}`;
              check(`${name}: first room uses the designed geometry`, ['glb', 'observatory'].includes(measured.shellKind), measured.shellKind);
              if (!args['allow-missing-metrics']) {
                check(`${name}: runtime reports first room readiness`, typeof measured.runtime?.visit?.firstRoomReadyMs === 'number' && Number.isFinite(measured.runtime.visit.firstRoomReadyMs));
              }
            }
          }
        } finally { await context.close(); }
      }
    }
  }
}

async function axeAudit(page, name) {
  const result = compactAxe(await new AxeBuilder({ page }).withTags(tags).analyze());
  report.measurements.push({ kind: 'accessibility', name, ...result });
  check(`${name}: no automatic WCAG A/AA violations`, result.violations.length === 0, result.violations);
}

async function landingAudit(profile) {
  const { context, page, events } = await newPage(profile);
  try {
    await ready(page, '/');
    await page.locator('img[loading=lazy]').scrollIntoViewIfNeeded();
    await page.locator('img[loading=lazy]').evaluate((image) => image.decode());
    await page.evaluate(() => scrollTo(0, 0));
    if (['desktop', 'phone'].includes(profile.name)) await screenshot(page, `landing-${profile.name}`, true);
    const layout = await page.evaluate(() => {
      const discrete = [...document.querySelectorAll('.button,.site-nav a,.room,.wordmark,.follow-links a,.site-footer a,summary')];
      const targets = discrete.filter((el) => el.getClientRects().length > 0).map((el) => {
        const rect = el.getBoundingClientRect();
        return { name: el.textContent.trim(), width: rect.width, height: rect.height };
      });
      return {
        overflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
        discreteTargets: targets.length,
        targetsBelow44px: targets.filter((rect) => rect.width < 44 || rect.height < 44),
        missingAnchorTargets: [...document.querySelectorAll('a[href^="#"]')].filter((link) => !document.getElementById(link.hash.slice(1))).map((link) => link.hash),
      };
    });
    report.measurements.push({ kind: 'landing-layout', profile: profile.name, ...layout });
    check(`landing ${profile.name}: no horizontal overflow`, layout.overflowPx <= 1, layout.overflowPx);
    check(`landing ${profile.name}: images load`, layout.brokenImages.length === 0, layout.brokenImages);
    check(`landing ${profile.name}: fragment links resolve`, layout.missingAnchorTargets.length === 0);
    if (profile.touch) check(`landing ${profile.name}: discrete touch targets at least 44px`, layout.targetsBelow44px.length === 0, layout.targetsBelow44px);
    await axeAudit(page, `landing ${profile.name}`);
    if (!profile.touch) {
      await page.keyboard.press('Tab');
      check('landing: first keyboard stop is Skip to content', await page.getByRole('link', { name: 'Skip to content' }).evaluate((el) => document.activeElement === el));
      await page.keyboard.press('Enter');
      check('landing: skip link moves focus to main content', await page.locator('main').evaluate((el) => document.activeElement === el || el.contains(document.activeElement)));
      await page.evaluate(() => {
        const bodySize = Number.parseFloat(getComputedStyle(document.body).fontSize);
        document.documentElement.style.fontSize = '200%';
        document.body.style.fontSize = `${bodySize * 2}px`;
      });
      check('landing: doubled text does not cause horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    check(`landing ${profile.name}: no script or console errors`, events.pageErrors.length + events.consoleErrors.length === 0, events);
    check(`landing ${profile.name}: no external connections`, events.externalRequests.length + events.externalSockets.length === 0, events.externalRequests);
  } finally { await context.close(); }
}

async function appAudit(profile) {
  const { context, page, events } = await newPage(profile);
  const name = `demo ${profile.name}`;
  try {
    await ready(page, '/mind/?demo');
    await page.locator('dialog[open]').waitFor();
    if (profile.name === 'phone') await screenshot(page, 'guide-phone');
    check(`${name}: guide starts at its heading`, await page.locator('#guide-title').evaluate((el) => document.activeElement === el));
    await axeAudit(page, `${name} guide`);
    await page.keyboard.press('Escape');
    await page.locator('.scrubber:not([hidden])').waitFor({ timeout: 30000 });
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return { width: innerWidth, height: innerHeight, transport: rect('.scrubber'), stick: rect('.stick'), top: rect('.top-right'), location: rect('.location'), notices: rect('.notices') };
    });
    report.measurements.push({ kind: 'app-layout', profile: profile.name, ...layout });
    for (const [part, rect] of Object.entries(layout).filter(([, value]) => value && typeof value === 'object')) {
      check(`${name}: ${part} stays in viewport`, rect.x >= -1 && rect.y >= -1 && rect.right <= layout.width + 1 && rect.bottom <= layout.height + 1, rect);
    }
    if (profile.touch) check(`${name}: tape controls clear the joystick`, overlapArea(layout.transport, layout.stick) === 0);
    await page.getByRole('button', { name: 'Guide', exact: true }).focus();
    const playingBefore = await page.evaluate(() => window.grove.world.tape.playing);
    await page.keyboard.press('Space');
    check(`${name}: Space opens Guide without toggling playback`, await page.locator('.visitor-guide[open]').evaluate((el) => el.open) && await page.evaluate(() => window.grove.world.tape.playing) === playingBefore);
    await page.keyboard.press('Escape');
    check(`${name}: dialog returns focus to its trigger`, await page.getByRole('button', { name: 'Guide', exact: true }).evaluate((el) => document.activeElement === el));
    if (!profile.touch) {
      const pause = page.locator('.scrubber button');
      if (await page.evaluate(() => window.grove.world.tape.playing)) await pause.click();
      const bodyBefore = await page.evaluate(() => ({ x: window.grove.body.x, z: window.grove.body.z }));
      const slider = page.locator('.scrubber input[type=range]');
      await slider.focus();
      const timeBefore = Number(await slider.inputValue());
      await page.keyboard.press('ArrowRight');
      check(`${name}: arrow key scrubs instead of walking`, Number(await slider.inputValue()) > timeBefore && JSON.stringify(await page.evaluate(() => ({ x: window.grove.body.x, z: window.grove.body.z }))) === JSON.stringify(bodyBefore));
      await page.locator('#stage').focus();
      await page.keyboard.press('f');
      await page.locator('.perf:not([hidden])').waitFor();
      await screenshot(page, 'performance-desktop');
      check(`${name}: timing overlay opens from keyboard`, await page.locator('.perf').isVisible());
      const overlay = await page.locator('.perf').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      report.measurements.push({ kind: 'performance-overlay-layout', profile: profile.name, ...overlay });
      check(`${name}: timing overlay clears tape controls`, overlapArea(overlay, layout.transport) === 0);
      check(`${name}: timing overlay stays in viewport`, overlay.x >= 0 && overlay.y >= 0 && overlay.right <= profile.width && overlay.bottom <= profile.height);
      if (!args['allow-missing-metrics']) {
        const region = page.getByRole('region', { name: 'Rendering performance', exact: true });
        await region.focus();
        const position = await page.evaluate(() => ({ x: window.grove.body.x, z: window.grove.body.z }));
        const canScroll = await region.evaluate((el) => el.scrollHeight > el.clientHeight);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(150);
        check(`${name}: focused timing region keeps movement keys in the interface`, await region.evaluate((el) => el === document.activeElement) && JSON.stringify(await page.evaluate(() => ({ x: window.grove.body.x, z: window.grove.body.z }))) === JSON.stringify(position));
        if (canScroll) check(`${name}: timing region scrolls from keyboard`, await region.evaluate((el) => el.scrollTop > 0));
        await page.locator('#stage').focus();
      }
      await page.keyboard.press('f');
      await page.locator('.perf').waitFor({ state: 'hidden' });
    }
    await metricsAudit(page, name, !profile.touch);
    check(`${name}: no script or console errors`, events.pageErrors.length + events.consoleErrors.length === 0, events);
    check(`${name}: no external connections`, events.externalRequests.length + events.externalSockets.length === 0, events.externalRequests);
  } finally { await context.close(); }
}


async function metricsAudit(page, name, injectStall = false) {
  const metrics = await page.evaluate(() => typeof window.grove?.metrics === 'function' ? window.grove.metrics() : null);
  report.measurements.push({ kind: 'runtime-metrics', name, available: metrics !== null, snapshot: metrics });
  if (!metrics && args['allow-missing-metrics']) return;
  check(`${name}: runtime metrics are available`, metrics !== null);
  if (!metrics) return;
  const visit = metrics.visit;
  const frames = metrics.frames;
  const finite = [visit?.firstRoomReadyMs, visit?.firstTapeReadyMs, frames?.meanMs, frames?.p50Ms, frames?.p95Ms, frames?.p99Ms, frames?.maxMs, frames?.overBudgetPercent];
  check(`${name}: readiness and frame metrics are finite`, finite.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0), finite);
  check(`${name}: frame percentiles are ordered`, frames.samples > 0 && frames.p50Ms <= frames.p95Ms && frames.p95Ms <= frames.p99Ms && frames.p99Ms <= frames.maxMs, frames);
  if (injectStall) {
    // Deliberately block only this throwaway audit page, then observe the next
    // real RAF interval. Calling perf.sample directly would only test itself.
    const result = await page.evaluate(async () => {
      // Clear only the rolling diagnostic window in this disposable page.
      // Otherwise a previous long frame could mask a wrongly clamped stall.
      const target = window.grove.metrics().frames.targetHz;
      window.grove.perf.setTargetHz(target + 1);
      window.grove.perf.setTargetHz(target);
      const before = window.grove.metrics().frames;
      await new Promise((accept) => requestAnimationFrame(accept));
      const start = performance.now();
      while (performance.now() - start < 250) { /* intentional audit-only stall */ }
      const blockedMs = performance.now() - start;
      await new Promise((accept) => requestAnimationFrame(() => requestAnimationFrame(accept)));
      return { blockedMs, before, after: window.grove.metrics().frames };
    });
    report.measurements.push({ kind: 'injected-stall', name, ...result });
    check(`${name}: raw 250ms stall survives simulation clamping`, result.after.maxMs >= 240 && result.after.sessionStalls > result.before.sessionStalls, result);
  }
}

/** Polls until the renderer's object counts stop changing, so a lap reads a settled room. */
async function settledRendering(page, { quietMs = 1000, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  let last = null;
  let quietSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    const now = await page.evaluate(() => {
      const { geometries, textures, programs } = window.grove.metrics().rendering;
      return { geometries, textures, programs };
    });
    if (last && now.geometries === last.geometries && now.textures === last.textures && now.programs === last.programs) {
      if (Date.now() - quietSince >= quietMs) return { ...now, settled: true };
    } else {
      quietSince = Date.now();
    }
    last = now;
    await page.waitForTimeout(250);
  }
  return { ...last, settled: false };
}

/**
 * Issue #6: nothing is recreated every time a room is visited.
 *
 * Rooms load as a visitor comes near and are never unloaded, so the first
 * lap of the building legitimately grows the renderer's geometries, textures
 * and programs. A SECOND lap over rooms that are all already loaded must not
 * grow them at all: growth there is something rebuilt on each arrival and
 * never disposed, which is a leak whose size is the number of crossings.
 * Counted in renderer objects, so the check is the same on a CI runner and a
 * headset; frame times are only recorded, per this report's limits.
 *
 * A room's wall text, door names and reading stands land after its shell,
 * and the renderer counts a geometry only once it has been in view: a
 * plaque built after the tour left its room, in a chamber the fixed heading
 * never faces again, would be counted on a later lap as if it were new. So
 * each visit waits for the world to settle (`grove.settled`), a lap ends
 * with a full turn on the spot, and the laps compared are the SECOND and
 * the THIRD: by the end of lap one everything has loaded, lap two draws
 * whatever of it the route can see, and lap three sees exactly the same
 * again, so any growth there is a rebuild per arrival.
 */
/** A full turn on the spot, a frame per heading, so everything around the body has been in view. */
async function lookAround(page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const body = window.grove.body;
    const yaw = body.yaw;
    for (let k = 1; k <= 8; k++) {
      body.yaw = yaw + (k * Math.PI) / 4;
      await frame();
    }
    body.yaw = yaw;
    await frame();
  });
}

async function roomTourAudit() {
  const profile = profiles[0];
  const { context, page, events } = await newPage(profile);
  const name = 'room tour';
  try {
    await ready(page, '/mind/?demo');
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    const rooms = await page.evaluate(() => window.grove.mansion.rooms.map((room) => room.id));
    const start = await page.evaluate(() => window.grove.body.room);
    const laps = [];
    for (let lap = 1; lap <= 3; lap++) {
      const refused = [];
      const unsettled = [];
      for (const room of rooms) {
        if (!(await page.evaluate((id) => window.grove.visit(id), room))) refused.push(room);
        await page.evaluate(() => window.grove.settled());
        const counts = await settledRendering(page);
        if (!counts.settled) unsettled.push(room);
      }
      await page.evaluate((id) => window.grove.visit(id), start);
      await page.evaluate(() => window.grove.settled());
      await lookAround(page);
      const end = await settledRendering(page);
      laps.push({ lap, refused, unsettled, ...end });
    }
    const frames = await page.evaluate(() => window.grove.metrics().frames);
    report.measurements.push({ kind: 'room-tour', rooms: rooms.length, laps, frames: { p50Ms: frames.p50Ms, p95Ms: frames.p95Ms, p99Ms: frames.p99Ms, sessionStalls: frames.sessionStalls }, frameBudgetP95Ms: 13.8, frameBudgetEnforced: false });
    const [first, second, third] = laps;
    check(`${name}: every room can be visited`, first.refused.length === 0, first.refused);
    check(`${name}: every room settles`, laps.every((lap) => lap.unsettled.length === 0), laps.map((lap) => lap.unsettled));
    for (const kind of ['geometries', 'textures', 'programs']) {
      check(`${name}: a third lap creates no ${kind}`, third[kind] <= second[kind], { first: first[kind], second: second[kind], third: third[kind] });
    }
    check(`${name}: no script or console errors`, events.pageErrors.length + events.consoleErrors.length === 0, events);
  } finally { await context.close(); }
}

async function recoveryAudit() {
  const { context, page } = await newPage(profiles[0], { disableGraphics: true });
  try {
    await page.goto(`${base}/mind/?demo`, { waitUntil: 'networkidle' });
    const fallback = page.locator('#boot-status');
    check('startup: graphics failure leaves readable recovery controls', await fallback.isVisible() && await page.getByRole('button', { name: 'Reload', exact: true }).isVisible() && await page.getByRole('link', { name: 'Back to the website', exact: true }).isVisible());
    await axeAudit(page, 'graphics startup recovery');
  } finally { await context.close(); }
}

async function gameSurfaceAudit() {
  const { context, page, events } = await newPage(profiles[0], { gameFixture: true });
  try {
    await ready(page, '/mind/?demo&room=orangery');
    await page.getByRole('button', { name: 'Open FTL Chess' }).click();
    const surface = page.locator('.game-surface[open]');
    await surface.waitFor();
    await page.getByText('Game ready', { exact: true }).waitFor();
    const frame = page.frameLocator('.game-surface-frame');
    await frame.getByRole('button', { name: 'Start game' }).evaluate((button) => button.click());
    await page.getByText('Game ended', { exact: true }).waitFor();
    check('game surface: lifecycle events reach the exact parent', (await page.evaluate(() => window.grove.metrics().gameSurface.lastEvent)) === 'game-ended');
    await axeAudit(page, 'FTL Chess game surface');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // `dialog.close()` fires its close event as a QUEUED TASK, and the handler
    // that removes the iframe and restores focus runs there (ui/game-surface.ts
    // #closed). Sampling both the instant the click returns races that task:
    // this check passed locally and failed in CI on identical bytes, and a
    // rerun of the same commit went green. Wait for the teardown first -- but
    // swallow the wait's own timeout and keep the assertion below as the
    // verdict, so a real regression is still reported as a failed check with a
    // name rather than as an error with a stack.
    await page.locator('.game-surface-frame').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    await page.waitForFunction(() => document.activeElement === document.getElementById('stage'), null, { timeout: 10000 }).catch(() => undefined);
    check('game surface: close tears down the iframe and restores the view', await page.locator('.game-surface-frame').count() === 0 && await page.locator('#stage').evaluate((el) => document.activeElement === el));
    check('game surface: no script or console errors', events.pageErrors.length + events.consoleErrors.length === 0, events);
  } finally { await context.close(); }
}

let base;
try {
  if (args.dist) ownedServer = await startStaticServer(resolve(grove, args.dist), { gzip: args.gzip });
  else if (!args['base-url']) {
    runPackageScript('dev:bundle');
    runPackageScript('prepare:assets');
    const { createServer } = await import('vite');
    const vite = await createServer({ root: grove, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
    ownedServer = { close: () => vite.close() };
    await vite.listen();
    ownedServer.url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  }
  base = (args['base-url'] ?? ownedServer.url).replace(/\/$/, '');
  const address = new URL(base);
  if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Browser quality checks require a local HTTP origin.');
  browser = await chromium.launch({
    headless: true, ...(args.executable ? { executablePath: args.executable } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  const landingResponse = await fetch(`${base}/`);
  if (!landingResponse.ok) throw new Error(`Landing response: HTTP ${landingResponse.status}`);
  const servedLanding = Buffer.from(await landingResponse.arrayBuffer());
  report.environment = {
    browser: browser.version(), node: process.version, platform: `${process.platform}/${process.arch}`,
    mode: args.dist ? 'production-build' : 'synthetic-demo',
    transport: args.dist ? (args.gzip ? 'local gzip model for text and WASM' : 'local identity encoding') : 'Vite development transport',
    landingSha256: createHash('sha256').update(servedLanding).digest('hex'),
    landingFingerprint: 'Decoded HTML response served by the audited origin',
    serviceWorkers: 'blocked', samples,
  };
  if (['all', 'transfer'].includes(args.scope)) await transferAudit();
  if (['all', 'landing'].includes(args.scope)) for (const profile of profiles.slice(0, 3)) await landingAudit(profile);
  if (!args.dist && ['all', 'app'].includes(args.scope)) {
    for (const profile of profiles) await appAudit(profile);
    await gameSurfaceAudit();
    await recoveryAudit();
  }
  if (!args.dist && ['all', 'app', 'memory'].includes(args.scope)) await roomTourAudit();
} catch (error) {
  report.errors.push([error?.stack ?? String(error), error?.stdout?.toString(), error?.stderr?.toString()].filter(Boolean).join('\n'));
} finally {
  try { if (browser) await browser.close(); }
  catch (error) { report.errors.push(`Browser cleanup: ${error?.stack ?? error}`); }
  try { if (ownedServer) await ownedServer.close(); }
  catch (error) { report.errors.push(`Server cleanup: ${error?.stack ?? error}`); }
  report.summary = {
    checks: report.checks.length, passed: report.checks.filter((item) => item.pass).length,
    failed: report.checks.filter((item) => !item.pass).length,
    errors: report.errors.length,
    automaticAxeViolations: report.measurements.filter((item) => item.kind === 'accessibility').reduce((sum, item) => sum + item.violations.length, 0),
    manualReviewFindings: report.measurements.filter((item) => item.kind === 'accessibility').reduce((sum, item) => sum + item.needsManualReview.length, 0),
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...report.summary }));
  if (!args['record-only'] && (report.summary.failed || report.summary.errors)) process.exitCode = 1;
}
