import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

export interface ManifestEntry {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
export type BuildManifest = Record<string, ManifestEntry>;

/** Require explicit deferred entries, so an inlined or accidentally eager SDK fails closed. */
export function deferredContracts(manifest: BuildManifest, startup: readonly string[]) {
  return [
    { module: "presence SDK", matches: (key: string) => key === "src/module_bindings/index.ts" },
    { module: "HLS decoder", matches: (key: string) => /\/hls\.js\//.test(key) },
  ].map(({ module, matches }) => {
    const keys = Object.keys(manifest).filter(matches);
    const files = keys.map((key) => manifest[key]!.file);
    return {
      module, files,
      status: files.length === 0 ? "missing deferred entry" : files.some((file) => startup.includes(file)) ? "loaded at startup" : "deferred",
    };
  });
}

/** Static imports only. main.ts is an explicit root because bootstrap imports it immediately. */
export function startupFiles(manifest: BuildManifest, roots: readonly string[]): string[] {
  const visited = new Set<string>();
  const files = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`build manifest is missing startup module ${key}`);
    visited.add(key);
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    for (const imported of entry.imports ?? []) visit(imported);
  };
  roots.forEach(visit);
  return [...files].sort();
}

function inventory(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? inventory(root, path) : [relative(root, path).replaceAll("\\", "/")];
  }).sort();
}

function category(path: string): string {
  if (path.startsWith("basis/")) return "transcoder";
  if (/\.js$/.test(path)) return "javascript";
  if (/\.css$/.test(path)) return "css";
  if (/\.glb$/.test(path)) return "geometry";
  if (/\.ktx2$/.test(path)) return "compressedTextures";
  if (/\.(png|jpe?g|webp|avif|svg)$/.test(path)) return "images";
  return "other";
}

export function measureBuild(directory: string) {
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(join(root, ".vite/manifest.json"), "utf8")) as BuildManifest;
  const startup = startupFiles(manifest, ["mind/index.html", "src/main.ts"]);
  const contracts = deferredContracts(manifest, startup);
  const files = inventory(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return {
      path, category: category(path), bytes: bytes.length,
      // Reproducible compression estimate, not a claim about a CDN's transfer encoding.
      gzipBytes: /\.(js|css|html|json|svg)$/.test(path) ? gzipSync(bytes, { level: 9 }).length : null,
      startup: startup.includes(path),
    };
  });
  for (const path of startup) {
    if (!files.some((file) => file.path === path)) throw new Error(`startup asset is absent: ${path}`);
  }
  const sum = (selected: typeof files, key: "bytes" | "gzipBytes"): number => selected.reduce((total, file) => total + (file[key] ?? file.bytes), 0);
  // The versioned Basis shim is JavaScript too, despite its semantic category.
  const js = files.filter((file) => file.path.endsWith(".js"));
  const startupJs = js.filter((file) => file.startup);
  const groups: Record<string, { files: number; bytes: number }> = {};
  for (const file of files) {
    const group = groups[file.category] ??= { files: 0, bytes: 0 };
    group.files++;
    group.bytes += file.bytes;
  }
  return {
    schema: "grove-build-metrics/1",
    build: JSON.parse(readFileSync(join(root, "version.json"), "utf8")) as { commit: string; builtAt: string; sw: boolean },
    definitions: {
      startup: "grove bootstrap and immediately imported main.ts plus static dependencies; excludes deferred loaders, room assets and media",
      gzip: "gzip level 9 per text asset; estimate, not measured network transfer",
      total: "all non-hidden output files including optional fallbacks; clean checkouts may have fewer local bake files",
    },
    metrics: {
      deferredModuleViolations: contracts.filter((contract) => contract.status !== "deferred").length,
      totalBytes: sum(files, "bytes"),
      totalFiles: files.length,
      startupJsBytes: sum(startupJs, "bytes"),
      startupJsGzipBytes: sum(startupJs, "gzipBytes"),
      startupJsRequests: startupJs.length,
      allJsGzipBytes: sum(js, "gzipBytes"),
      largestJsGzipBytes: Math.max(0, ...js.map((file) => file.gzipBytes ?? 0)),
      cssGzipBytes: sum(files.filter((file) => file.category === "css"), "gzipBytes"),
      siteImageBytes: sum(files.filter((file) => file.category === "images" && file.path.startsWith("site/")), "bytes"),
    },
    groups,
    loadingContracts: contracts,
    files,
  };
}

export function budgetFailures(metrics: Record<string, number>, budgets: Record<string, number>): string[] {
  const failures: string[] = [];
  for (const [name, limit] of Object.entries(budgets)) {
    if (!Number.isFinite(limit) || limit < 0) throw new Error(`invalid budget for ${name}`);
    const value = metrics[name];
    if (value === undefined || !Number.isFinite(value)) throw new Error(`unknown or invalid metric ${name}`);
    if (value > limit) failures.push(`${name}: ${value} exceeds ${limit}`);
  }
  return failures;
}
