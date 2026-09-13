// Render stations: fixed camera positions shot from a running preview and
// compared with the last accepted set, so a regression is seen before a
// deploy rather than by a visitor.
//
//   node grove/tools/palace/stations.mjs [--base http://localhost:4173/grove/] [--out docs/img/stations] [--accept] [station ...]
//
// Each station is shot at 640x400 (JPEG, small enough to commit). Without
// --accept the new shot goes to <out>/<name>.new.jpg and is compared with
// <out>/<name>.jpg by tools/palace/stations_diff.py; with --accept it
// replaces the reference. A station marked `probe` is shot twice with the
// camera 2 mm apart: faces that fight the depth buffer flip between the
// two frames, solid geometry does not, and the diff says which.
//
// Needs the preview served (`pnpm exec vite preview --port 4173`) and a
// Chromium: CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome.
// The media bucket's CORS allows the localhost origin, not 127.0.0.1.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const STATIONS = [
  // name, room, x, z, yaw, pitch, probe
  ["hall-spawn", "hall", null, null, null, 0, false],
  ["hall-door-einstruct", "hall", 0, -6.5, 0, 0, true],
  ["hall-door-terrace", "hall", -3, 1.667, 90, 0, false],
  ["hall-jamb-close", "hall", 0.9, -8.9, -35, 5, true],
  ["einstruct-door-hall", "einstruct", 0, -13, 180, 0, false],
  ["phototroph-spawn", "phototroph", null, null, null, 0, false],
  ["world-engine-stills", "world-engine", 0, -28, -90, 0, false],
  ["gallery-door-hnl", "gallery", 3.5, 51.5, -90, 0, true],
  ["gallery-poster-end", "gallery", 3.5, 24.3, -90, 0, false],
  ["spectre-spawn", "spectre", null, null, null, 0, false],
  ["greenhouse-level", "greenhouse", null, null, 180, 0, false],
  ["orangery-door", "orangery", -4.5, -40, 90, -35, true],
  ["terrace-facade-hall-door", "terrace", -12, 1.667, -90, 0, false],
  ["terrace-facade-along", "terrace", -11, 20, -40, 0, false],
  ["terrace-facade-orangery", "terrace", -12, -52, -90, 0, false],
  ["parterre-hedge-corner", "parterre", -20, -6, 90, -25, false],
  ["parterre-basin", "parterre", -35, 12, 0, -10, false],
  ["orchard-west", "orchard-west", null, null, 90, 0, false],
];

function stationUrl(base, [, room, x, z, yaw, pitch], dx = 0) {
  const q = new URLSearchParams({ room });
  if (x !== null) q.set("x", String(x + dx));
  if (z !== null) q.set("z", String(z));
  if (yaw !== null) q.set("yaw", String(yaw));
  if (pitch !== null) q.set("pitch", String(pitch));
  return `${base}?${q}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One headless Chromium, one page, N navigations; returns JPEG buffers. */
async function shoot(urls, port, waitMs) {
  const chrome = spawn(process.env.CHROME ?? "chromium", [
    "--headless=new", "--no-sandbox", "--disable-quic", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--hide-scrollbars", "--host-resolver-rules=MAP media.weichseltree.com 104.21.43.53",
    `--remote-debugging-port=${port}`, "--window-size=640,400", "--autoplay-policy=no-user-gesture-required", "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
  }
  if (!targets) throw new Error("chromium did not answer on its debug port");
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description).join(" ");
      if (/did not load|HTTP 4|HTTP 5/.test(text)) errors.push(text);
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 400, deviceScaleFactor: 1, mobile: false });
  const out = [];
  for (const url of urls) {
    errors.length = 0;
    await send("Page.navigate", { url });
    await sleep(waitMs);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
    out.push({ url, jpeg: Buffer.from(shot.data, "base64"), errors: [...errors] });
  }
  ws.close();
  chrome.kill();
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const base = opt("--base", "http://localhost:4173/grove/");
  const outDir = opt("--out", "docs/img/stations");
  const accept = args.includes("--accept");
  const waitMs = Number(opt("--wait", "20000"));
  const names = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--accept"].includes(args[i - 1])));
  const chosen = STATIONS.filter((s) => names.length === 0 || names.includes(s[0]));
  mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (const s of chosen) {
    jobs.push({ name: s[0], url: stationUrl(base, s) });
    if (s[6]) jobs.push({ name: `${s[0]}.probe`, url: stationUrl(base, s, 0.002) });
  }
  const shots = await shoot(jobs.map((j) => j.url), 9500 + (process.pid % 400), waitMs);
  let firstTime = 0;
  shots.forEach((shot, i) => {
    const { name } = jobs[i];
    const isProbe = name.endsWith(".probe");
    const ref = join(outDir, `${name}.jpg`);
    const target = accept && !isProbe ? ref : join(outDir, `${name}.new.jpg`);
    if (!isProbe && !existsSync(ref) && !accept) firstTime++;
    writeFileSync(target, shot.jpeg);
    const note = shot.errors.length ? `  (${shot.errors.length} load errors: ${shot.errors[0]})` : "";
    console.log(`${accept && !isProbe ? "accepted" : "shot    "} ${name}${note}`);
  });
  if (firstTime) console.log(`${firstTime} station(s) have no reference yet; run with --accept once they look right`);
  if (!accept) console.log(`compare: python3 grove/tools/palace/stations_diff.py ${outDir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
