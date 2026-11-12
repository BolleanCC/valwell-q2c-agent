#!/usr/bin/env node
/**
 * pnpm generate -- --seed 42 --jobs 50 [--customers 4] [--out data/<dir>]
 *
 * Writes one JSON file per system store plus fault_labels.json and manifest.json.
 */
import { parseArgs } from "node:util";
import { generateBatch, STORE_FILES } from "./batch.js";
import { writeBatch } from "./write.js";

const { values } = parseArgs({
  // pnpm may forward a literal "--" separator; ignore it.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    seed: { type: "string", default: "42" },
    jobs: { type: "string", default: "50" },
    customers: { type: "string", default: "4" },
    out: { type: "string" },
  },
});

const toInt = (name: string, raw: string): number => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`--${name} must be an integer, got "${raw}"`);
  return n;
};

const seed = toInt("seed", values.seed);
const jobs = toInt("jobs", values.jobs);
const customers = toInt("customers", values.customers);
const out = values.out ?? `data/batch-seed${seed}-jobs${jobs}`;

const files = generateBatch({ seed, jobs, customers });
await writeBatch(out, files);

const manifest = files[STORE_FILES.manifest] as { faultCounts: Record<string, number> };
const faults = Object.entries(manifest.faultCounts)
  .map(([code, n]) => `${code}=${n}`)
  .join(" ");
console.log(`Wrote ${jobs} jobs (seed ${seed}) to ${out}  faults: ${faults || "none"}`);
