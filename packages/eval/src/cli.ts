#!/usr/bin/env node
/**
 * pnpm eval -- --batch data/<batch> [--min-recall 0.9] [--out data/runs/<batch>]
 *
 * Runs the agent, scores it against fault_labels.json, runs the portal
 * experiment, prints the results and writes eval.md. Exits 1 when any
 * friction code's recall is below --min-recall (used as the CI gate).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { evaluateBatch } from "./experiment.js";
import { recallFailures, renderEvaluation } from "./report.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    batch: { type: "string" },
    "min-recall": { type: "string" },
    out: { type: "string" },
  },
});
if (!values.batch) {
  console.error("Usage: pnpm eval -- --batch <batch dir> [--min-recall 0-1] [--out <dir>]");
  process.exit(2);
}

const name = basename(values.batch);
const out = values.out ?? join("data", "runs", name);
const evaluation = await evaluateBatch(values.batch);
const markdown = renderEvaluation(name, evaluation);

await mkdir(out, { recursive: true });
await writeFile(join(out, "eval.md"), markdown);
console.log(markdown);
console.log(`Wrote ${join(out, "eval.md")}`);

if (values["min-recall"] !== undefined) {
  const min = Number(values["min-recall"]);
  if (!(min >= 0 && min <= 1)) {
    console.error(`--min-recall must be between 0 and 1, got "${values["min-recall"]}"`);
    process.exit(2);
  }
  const failures = recallFailures(evaluation.score.byCode, min);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`Recall gate failed: ${f.code} recall ${f.recall} < ${min}`);
    }
    process.exit(1);
  }
  console.log(`Recall gate passed: every friction code ≥ ${min}`);
}
