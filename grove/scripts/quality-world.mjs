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
  ['court-north', -15, -97, 180, 2],
  ['stair-north', -15, -78, 0, 6],
  ['foyer', -15, -41, -90, 3],
  ['club', 0, -20, 0, 4],
  ['stage', 2.2, -74.5, 180, 4],
  ['gallery', 0, 33, 180, 12],
  ['belvedere', 0, 70, 0, -3],
  ['greenhouse', 11.5, 8, -90, 8],
  ['terrace', -15, 10, 90, 5],
  // The north arm, looking along the promenade past the orangery's doors: it
  // was drawn as open grove until 2026-09-18, which no station would have seen.
  ['terrace-north', -15, -50, 0, 5],
  // On the court's east walk, the way round the garden flight, looking north
  // to the club's door and the north flight beyond: standing in the middle of
  // the court (the old station, z = -23) put the camera inside the garden
  // flight's own steps, and a metre short of its cheek wall shows only stone.
  ['stair-court', -11.6, -19.5, 0, 2],
  ['foyer-south', -15, -8, 180, 3],
  ['parterre', -26, 0, 90, 4],
  ['orchard-west', -45, -60, 0, 5],
  ['orchard-south', -80, 0, 90, 5],
  ['court-south', -15, 93, 0, 2],
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
  // The palace's seventeen with the cellar venue and its two garden courts,
  // arcedit's six since its redesign (2026-09-17), quantumflow's six in the east
  // wing, and the sunken court's three: the middle flight, the south foyer and
  // the north terrace.
  check('All 36 rooms use runtime architecture (35 Observatory, the Orrery in space)', world.rooms.length === 36
    && world.rooms.filter((room) => room.architecture === 'observatory').length === 35
    && world.rooms.filter((room) => room.architecture === 'space').length === 1, world.rooms);
  check('Architecture stays near fifteen draw batches a room across the whole world', world.batches < world.rooms.length * 16, world.batches);
  // Ten tapes: einstruct's two sheets, phototroph's three (the lit and dark
  // floors and the capture), arcedit's three (two episodes and the canvas),
  // and quantumflow's two (the shooting gallery's trial energies and the
  // flow). spectre's worlds are a planet hanging (no fixture in the demo),
  // and the terrace's moon is gone.
  check('Synthetic playback fixtures loaded', world.tapes === 10, world.tapes);
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
  // The armillary's far view, photographed. Every other check here counts
  // work that was ASKED for — a render call that returned, a shell that
  // stands — and on 2026-09-17 the Orrery was empty through the portal with
  // all of them green, because a far view WAS rendered: into a black
  // rectangle, past a frustum that stopped short of the room. So this one
  // reads pixels, in two places that cannot cover for each other: the disc
  // on screen, to ask whether the far room reaches the lens, and the far
  // view's own target, to ask what reached it.
  await page.evaluate((keep) => { window.__keepShots = keep; }, args.screenshots);
  const portal = await page.evaluate(() => {
    const app = window.grove;
    const room = app.mansion.rooms.find((r) => r.id === 'parterre');
    const end = room?.portals.find((p) => p.to === 'orrery');
    const shell = app.world.group.getObjectByName('orrery-shell');
    // Said as a named refusal rather than a stack trace out of the page: the
    // document is edited far more often than this check is.
    if (!room || !end) return { error: 'no portal from the garden to the Orrery in the document' };
    if (!shell) return { error: "the Orrery's shell is not in the world" };
    // Where the garden sets a visitor down, facing the armillary: the view
    // that was black, 33 m out, and the one the guide tells a visitor to take.
    const [sx, , sz] = room.spawn.position;
    const yaw = room.spawn.yawDeg * Math.PI / 180;
    const floor = room.bounds.min[1];
    Object.assign(app.body, { room: room.id, x: sx, y: floor, z: sz, yaw, pitch: 0 });
    app.view.rig.position.set(sx, floor, sz);
    app.view.rig.rotation.y = yaw;
    app.view.camera.rotation.set(0, 0, 0);
    app.view.rig.updateMatrixWorld(true);

    const gl = app.view.renderer.getContext();
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    // The lens on the screen, from the eye's own matrices: its centre in
    // pixels and its radius, read at 0.8 of the way out so the rim the
    // shader refracts and fades is left out of the count.
    const view = app.view.camera.matrixWorldInverse.elements, lens = app.view.camera.projectionMatrix.elements;
    const [ex, ey, ez] = end.position;
    const vz = view[2] * ex + view[6] * ey + view[10] * ez + view[14];
    const vx = view[0] * ex + view[4] * ey + view[8] * ez + view[12];
    const vy = view[1] * ex + view[5] * ey + view[9] * ez + view[13];
    const w = -vz;
    if (!(w > 0)) return { error: 'the armillary is behind the eye at the garden spawn' };
    const ndcX = (lens[0] * vx + lens[8] * vz) / w, ndcY = (lens[5] * vy + lens[9] * vz) / w;
    const cx = (ndcX * 0.5 + 0.5) * width, cy = (ndcY * 0.5 + 0.5) * height;
    const radiusPx = (end.radius * lens[5] * 0.5 * height) / w * 0.8;
    const x0 = Math.max(0, Math.floor(cx - radiusPx)), y0 = Math.max(0, Math.floor(cy - radiusPx));
    const x1 = Math.min(width, Math.ceil(cx + radiusPx)), y1 = Math.min(height, Math.ceil(cy + radiusPx));
    const boxW = x1 - x0, boxH = y1 - y0;

    const shoot = (live) => {
      // No time passes between shots: the lens shimmers on its own clock, and
      // a shot taken a frame later differs from its twin by a pixel or two,
      // which is the whole margin the noise floor has under it.
      app.portalFrame(live, 0);
      app.view.renderer.render(app.view.scene, app.view.camera);
      const pixels = new Uint8Array(boxW * boxH * 4);
      gl.readPixels(x0, y0, boxW, boxH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const difference = (a, b) => {
      let changed = 0;
      for (const i of offsets) {
        const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (delta > 8) changed++;
      }
      return changed / offsets.length;
    };
    const offsets = [];
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        const dx = x0 + x + 0.5 - cx, dy = y0 + y + 0.5 - cy;
        if (dx * dx + dy * dy <= radiusPx * radiusPx) offsets.push((y * boxW + x) * 4);
      }
    }
    const luminance = (pixels, i) => 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    /**
     * A field of luminance, described the way that tells a rendered room from
     * a cleared one: where its floor sits and how far above it the brightest
     * points stand. The Orrery's stars are sparse points far above their sky;
     * a cleared buffer carries the scene's own background and nothing above
     * it. `eighth` rather than the maximum, so no single hot pixel decides.
     */
    const describe = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      const median = at(0.5);
      return {
        median: Math.round(median), p99: Math.round(at(0.99)), max: Math.round(sorted[sorted.length - 1]),
        eighth: Math.round(sorted[Math.max(0, sorted.length - 8)]),
        brightFraction: values.filter((value) => value > median + 24).length / values.length,
      };
    };

    // Does the far view reach the lens? NOT by comparing the lens with the
    // far view switched off: the shader gates the whole far layer on `uLive`,
    // so the disc changes because its ALPHA changed, whether or not a single
    // far texel was sampled — measured identical, to sixteen digits, with a
    // far view and with a black one. Two LIVE shots instead, with the far
    // ROOM taken away between them: then only what came through the lens can
    // differ. Measured 0.78 when it comes through, 0.000 when it does not,
    // and 0.000 between two identical shots, so the floor has no noise under
    // it.
    const withRoom = shoot(true);
    shell.visible = false;
    const withoutRoom = shoot(true);
    shell.visible = true;
    const again = shoot(true);
    const farViewReaches = difference(withRoom, withoutRoom);
    const noise = difference(withRoom, again);
    // The weaker question, kept as a number and not a check: the lens does
    // something at all when its view goes.
    const lensGoesDark = difference(again, shoot(false));

    // And the far view itself, which says WHAT reached the lens. It comes
    // back as the target holds it — half-float and linear, tone mapping run
    // and the transfer function not — so the decode is here rather than in
    // the client, where every visitor would have shipped it.
    const rendersBefore = app.farRenders;
    shoot(true);
    const target = app.farTarget;
    const farLuma = [];
    let farSize = null;
    let readBack = false;
    let png = null;
    let centre = null;
    let region = null;
    if (target) {
      const fw = Math.max(1, Math.round(target.width * app.farViewScale));
      const fh = Math.max(1, Math.round(target.height * app.farViewScale));
      farSize = { width: fw, height: fh };
      // The target is half-float (a byte buffer reads back as zeros) and
      // linear: tone mapping has run on it, the transfer function has not.
      const raw = new Uint16Array(fw * fh * 4);
      // Three refuses a read whose format the backend does not offer, with a
      // console error and an untouched buffer. Said as its own condition, or
      // it surfaces as three unrelated failures and no cause.
      // The poison is not part of its own evidence: `raw.some(v => v !== 0)`
      // over the whole buffer finds the poison and is true whatever happened,
      // which is how the first version of this check could not fail.
      raw[0] = 0xffff;
      app.view.renderer.readRenderTargetPixels(target, 0, 0, fw, fh, raw);
      readBack = raw[0] !== 0xffff || raw.subarray(1).some((value) => value !== 0);
      const half = (h) => {
        const sign = h & 0x8000 ? -1 : 1, exponent = (h & 0x7c00) >> 10, fraction = h & 0x03ff;
        if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
        if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
        return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
      };
      const encoded = new Uint8ClampedArray(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const linear = Math.max(0, Math.min(1, half(raw[i])));
        encoded[i] = Math.round(255 * (i % 4 === 3 ? linear : linear ** (1 / 2.2)));
      }
      for (let i = 0; i < encoded.length; i += 4) farLuma.push(luminance(encoded, i));
      // Where the light sits, and over what. The Orrery's dome stands as a
      // ball a sixth of the frame across, the rest being the scene's own
      // background, so statistics over the whole frame are a quarter about
      // the room and the rest about how far away this check is standing —
      // move the station and the star fraction moves with the inverse square
      // of the distance, for no fault. The bright pixels' own bounding box
      // is the region the numbers are taken over, so they measure the room.
      const sorted = [...farLuma].sort((a, b) => a - b);
      // Two thresholds, on purpose: the box is FOUND against the frame's own
      // median, which is the page's background, so it finds what is brighter
      // than the room's surroundings; the numbers inside are then taken
      // against the region's median, which is the Orrery's sky. One
      // threshold cannot do both, because the two skies differ.
      const floor = sorted[Math.floor(sorted.length * 0.5)] + 24;
      const xs = [], ys = [];
      for (let i = 0; i < farLuma.length; i++) {
        if (farLuma[i] <= floor) continue;
        xs.push(i % fw);
        ys.push(Math.floor(i / fw));
      }
      const count = xs.length;
      if (count) {
        // The box is trimmed at the fiftieth of its points, and the centre is
        // a median rather than a mean, so a handful of stray bright pixels
        // somewhere else in the frame cannot drag either. Rows here are
        // bottom-up, as GL reads them; the saved PNG is flipped to top-down.
        const span = (values) => {
          const s = [...values].sort((a, b) => a - b);
          const cut = Math.floor(s.length * 0.02);
          return { lo: s[cut], hi: s[s.length - 1 - cut], mid: s[Math.floor(s.length / 2)] };
        };
        const sx = span(xs), sy = span(ys);
        const bx0 = sx.lo, bx1 = sx.hi, by0 = sy.lo, by1 = sy.hi;
        // Against the portal's own axis, not the middle of the frame: the far
        // camera stands on the line from the eye through the portal and keeps
        // the eye's own lens, so the exit projects exactly where the
        // armillary does. Move the spawn or the portal and this follows; turn
        // the far camera and it does not. The light measured is the dome's
        // rather than the exit's, and those coincide only because the dome
        // stands over the middle of a room whose middle is its landing: bounds
        // extended to one side would move the dome off the axis for no fault.
        // `offset` is in pixels scaled by the frame's HEIGHT, so a yaw error
        // and a pitch error of one angle count the same; `x` and `y` are
        // fractions of the frame's own width and height.
        const wantX = (ndcX * 0.5 + 0.5) * fw, wantY = (ndcY * 0.5 + 0.5) * fh;
        centre = {
          x: sx.mid / fw, y: sy.mid / fh,
          offset: Math.hypot(sx.mid - wantX, sy.mid - wantY) / fh,
        };
        // The ball's size, in frame heights on both axes so a round thing
        // reads round. Under it, the far view holds a scrap of the room and
        // the region's own statistics would call that a sky with stars; over
        // it, something bright stands outside the dome and the box is no
        // longer the ball.
        region = {
          x0: bx0, y0: by0, width: bx1 - bx0 + 1, height: by1 - by0 + 1,
          spanX: (bx1 - bx0 + 1) / fh, spanY: (by1 - by0 + 1) / fh,
        };
        const inside = [];
        for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) inside.push(farLuma[y * fw + x]);
        region.pixels = inside.length;
        Object.assign(region, describe(inside));
      }
      // The photograph itself, kept when the run keeps its others: a check
      // that photographs a portal and throws the photograph away leaves a
      // failure with nothing to look at. GL reads bottom-up, a canvas draws
      // top-down, so the rows go back the other way.
      if (window.__keepShots) {
        const canvas = document.createElement('canvas');
        canvas.width = fw;
        canvas.height = fh;
        const image = canvas.getContext('2d').createImageData(fw, fh);
        for (let y = 0; y < fh; y++) {
          const from = (fh - 1 - y) * fw * 4;
          image.data.set(encoded.subarray(from, from + fw * 4), y * fw * 4);
        }
        canvas.getContext('2d').putImageData(image, 0, 0);
        png = canvas.toDataURL('image/png');
      }
    }

    return {
      disc: { x: Math.round(cx), y: Math.round(cy), radius: Math.round(radiusPx), pixels: offsets.length },
      farViewReaches, noise, lensGoesDark,
      freshRenders: app.farRenders - rendersBefore,
      readBack,
      farView: farSize ? { ...farSize, ...describe(farLuma), centre, region } : null,
      png,
    };
  });
  if (portal.png) {
    const file = resolve(shotDir, 'armillary-far-view.png');
    const bytes = Buffer.from(portal.png.split(',')[1], 'base64');
    await writeFile(file, bytes);
    // Hashed like every station's capture: deterministic on SwiftShader, so
    // it is a baseline and not only something to look at after a failure.
    portal.screenshot = {
      file, width: portal.farView.width, height: portal.farView.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  delete portal.png;
  report.portal = portal;
  // Floors measured on 2026-09-17 in the state that ships and in three
  // broken ones: the depth-range fix taken back out, the far view rendered
  // but never composited, and the far camera turned half a radian. Shipping,
  // the far room owes 0.78 of the disc, its star ball reads median 17 with
  // the eighth-brightest pixel at 179 and a bright fraction of 4.4 in a
  // thousand, and that ball sits 0.011 of a frame height off the portal's
  // own axis. The frame's median is 23 in EVERY state, broken ones included:
  // it is the scene's background painted into the target before anything
  // else, so it is no evidence and is asked for none. What separates the
  // states is what stands above the sky, and where.
  if (portal.error) check(`The armillary could not be photographed: ${portal.error}`, false, portal);
  else {
    check('The far view was read back from its target', portal.readBack, portal);
    check('It was rendered for this photograph, not an earlier frame', portal.freshRenders > 0, portal);
    check('The far view reaches the lens: take the Orrery away and the armillary changes', portal.farViewReaches > 0.3, portal);
    check('And nothing else moves between two shots of the same view', portal.noise < 0.01, portal);
    check('What reaches it is the Orrery: star points stand far above its sky', Boolean(portal.farView?.region)
      && portal.farView.region.eighth - portal.farView.region.median > 80
      && portal.farView.region.brightFraction > 0.0015, portal);
    check('And the far camera looks down the portal, not somewhere else in the room', Boolean(portal.farView?.centre)
      && portal.farView.centre.offset < 0.08, portal);
    // Both region numbers are scale-free — contrast against the region's own
    // sky, a fraction of the region's own area — so a scrap of the room reads
    // exactly like the room. The dome's size on the far view is the
    // document's: measured a quarter of the frame's height, and a clipped cap
    // or a stray light outside the dome moves it off that.
    check('And what stands there is the dome, at the size the document gives it', Boolean(portal.farView?.region)
      && portal.farView.region.spanX > 0.12 && portal.farView.region.spanX < 0.5
      && portal.farView.region.spanY > 0.12 && portal.farView.region.spanY < 0.5, portal);
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
