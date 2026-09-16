import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { budgetFailures, deferredContracts, measureBuild, startupFiles } from "./metrics";

it("counts a shared static import once and excludes lazy media", () => {
  expect(startupFiles({
    boot: { file: "boot.js", imports: ["shared"], dynamicImports: ["main"] },
    main: { file: "main.js", imports: ["shared"], dynamicImports: ["video"], css: ["main.css"] },
    shared: { file: "shared.js", imports: ["main"] },
    video: { file: "hls.js" },
  }, ["boot", "main"])).toEqual(["boot.js", "main.css", "main.js", "shared.js"]);
  expect(() => startupFiles({}, ["main"])).toThrow("missing startup module");
});

it("fails closed for misspelled budgets and fails only values above the limit", () => {
  expect(budgetFailures({ bytes: 100 }, { bytes: 100 })).toEqual([]);
  expect(budgetFailures({ bytes: 101 }, { bytes: 100 })).toEqual(["bytes: 101 exceeds 100"]);
  expect(() => budgetFailures({ bytes: 100 }, { typo: 100 })).toThrow("unknown");
  expect(() => budgetFailures({ bytes: 100 }, { bytes: NaN })).toThrow("invalid budget");
});

it("catches optional SDKs pulled into startup through a shared helper or inlined entirely", () => {
  const manifest = {
    "src/module_bindings/index.ts": { file: "sdk.js" },
    "node_modules/hls.js/dist/hls.mjs": { file: "hls.js" },
  };
  expect(deferredContracts(manifest, ["sdk.js"]).map((entry) => entry.status)).toEqual(["loaded at startup", "deferred"]);
  expect(deferredContracts(manifest, []).every((entry) => entry.status === "deferred")).toBe(true);
  expect(deferredContracts({}, []).every((entry) => entry.status === "missing deferred entry")).toBe(true);
});

it("includes versioned transcoder JavaScript in the all-JS total", () => {
  const directory = mkdtempSync(join(tmpdir(), "grove-metrics-"));
  try {
    mkdirSync(join(directory, ".vite"));
    mkdirSync(join(directory, "basis/1.0.0"), { recursive: true });
    writeFileSync(join(directory, ".vite/manifest.json"), JSON.stringify({
      "mind/index.html": { file: "boot.js" }, "src/main.ts": { file: "main.js" },
    }));
    writeFileSync(join(directory, "version.json"), '{"commit":"fixture","builtAt":"fixture","sw":true}');
    writeFileSync(join(directory, "boot.js"), "boot");
    writeFileSync(join(directory, "main.js"), "main");
    writeFileSync(join(directory, "basis/1.0.0/shim.js"), "transcoder");
    const report = measureBuild(directory);
    expect(report.groups["transcoder"]?.files).toBe(1);
    expect(report.metrics.allJsGzipBytes - report.metrics.startupJsGzipBytes).toBe(gzipSync("transcoder", { level: 9 }).length);
    expect(report.build.commit).toBe("fixture");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
