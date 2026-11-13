#!/usr/bin/env node
/**
 * pnpm demo [-- --llm offline|live] [--out data/runs/demo]
 *
 * Runs the four fixed demo cases in data/fixtures/demo in a stable order,
 * prints the walkthrough and writes demo.md. No generator, no fault labels;
 * source fixtures are only read.
 *
 * --llm offline (default): case 4's change-order drafting uses a scripted,
 *   simulated "model" through the real tool loop. No network.
 * --llm live: case 4 makes real Anthropic API calls (paid). Needs
 *   ANTHROPIC_API_KEY in the environment or in .env; LLM_MODEL is optional.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_CASES, DEMO_HEADER, renderDemoCase, runDemoCase } from "./demo.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { out: { type: "string" }, llm: { type: "string", default: "offline" } },
});
if (values.llm !== "offline" && values.llm !== "live") {
  console.error(`--llm must be "offline" or "live", got "${values.llm}"`);
  process.exit(2);
}
const llm = values.llm;
if (llm === "live") {
  // Load .env if present; the key stays in the environment and is never printed.
  try {
    process.loadEnvFile(".env");
  } catch {}
}
const out = values.out ?? join("data", "runs", "demo");
const fixtures = join("data", "fixtures", "demo");

const sections = [
  DEMO_HEADER,
  llm === "live"
    ? "LLM mode: **live** (real Anthropic API calls for case 4)\n"
    : "LLM mode: **offline** (case 4 uses simulated LLM behaviour; run with `-- --llm live` for real calls)\n",
];
for (const [i, c] of DEMO_CASES.entries()) {
  sections.push(renderDemoCase(i + 1, c.title, await runDemoCase(join(fixtures, c.dir), { llm })));
}
const markdown = sections.join("\n");

await mkdir(out, { recursive: true });
await writeFile(join(out, "demo.md"), markdown);
console.log(markdown);
console.log(`Wrote ${join(out, "demo.md")}`);
