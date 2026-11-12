#!/usr/bin/env node
/**
 * pnpm agent -- --batch data/<batch> [--out data/runs/<batch>]
 *
 * Runs the agent over a batch's source-system stores and writes findings.json
 * and report.md. The default output directory is outside the batch so that
 * committed fixtures are never modified.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { openBatchSources } from "./adapters/json-batch.js";
import { runAgent } from "./pipeline.js";
import { renderReport } from "./report.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { batch: { type: "string" }, out: { type: "string" } },
});
if (!values.batch) {
  console.error("Usage: pnpm agent -- --batch <batch dir> [--out <dir>]");
  process.exit(2);
}

const name = basename(values.batch);
const out = values.out ?? join("data", "runs", name);
const run = runAgent(await openBatchSources(values.batch));

await mkdir(out, { recursive: true });
await writeFile(join(out, "findings.json"), `${JSON.stringify(run, null, 2)}\n`);
await writeFile(join(out, "report.md"), renderReport(run, name));

const counts = Object.entries(Object.groupBy(run.findings, (f) => f.frictionCode))
  .map(([code, fs]) => `${code}=${fs?.length ?? 0}`)
  .join(" ");
console.log(
  `Checked ${run.jobsChecked} jobs: ${run.findings.length} findings (${counts || "none"}) → ${out}/findings.json, report.md`,
);
