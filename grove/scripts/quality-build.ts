import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { budgetFailures, measureBuild } from "../build/metrics";

const { values } = parseArgs({ options: {
  dist: { type: "string", default: "dist" },
  output: { type: "string", default: "../results/quality/build.json" },
  budgets: { type: "string", default: "quality/budgets.json" },
  baseline: { type: "string" },
  "report-only": { type: "boolean", default: false },
} });
const report = measureBuild(values.dist);
const config = JSON.parse(readFileSync(resolve(values.budgets), "utf8")) as { maximum: Record<string, number> };
const failures = budgetFailures(report.metrics, config.maximum);
const baseline = values.baseline ? JSON.parse(readFileSync(resolve(values.baseline), "utf8")) as { metrics: Record<string, number> } : null;
const comparison = baseline ? Object.fromEntries(Object.entries(report.metrics).map(([key, value]) => {
  const before = baseline.metrics[key];
  return [key, { before: before ?? null, after: value, changePercent: before ? (100 * (value - before)) / before : null }];
})) : undefined;
const output = resolve(values.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...report, budgets: config.maximum, failures, comparison }, null, 2) + "\n");
console.log(JSON.stringify({ metrics: report.metrics, failures, comparison, report: output }, null, 2));
if (failures.length && !values["report-only"]) process.exitCode = 1;
