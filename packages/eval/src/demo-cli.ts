#!/usr/bin/env node
/**
 * pnpm demo [-- --llm offline|live] [--out data/runs/demo]
 *
 * Runs the four fixed demo cases in data/fixtures/demo in a stable order,
 * prints the walkthrough and writes demo.md. No generator, no fault labels;
 * source fixtures are only read.
 *
 * Every case is orchestrated by a model through the business tools.
 * --llm offline (default): scripted, simulated model turns through the real
 *   loop, tools and checks. No network.
 * --llm live: real Anthropic API calls for all four cases (paid). Needs
 *   ANTHROPIC_API_KEY in the environment or in .env; LLM_MODEL is optional.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { providerFor, runCaseDemo } from "./case-demo.js";
import { DEMO_CASES, DEMO_HEADER, renderCaseDemo } from "./case-demo-render.js";

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
    ? "LLM mode: **live** (real Anthropic API calls for every case)\n"
    : "LLM mode: **offline** (scripted, simulated model turns; run with `-- --llm live` for real calls)\n",
];
for (const [i, c] of DEMO_CASES.entries()) {
  sections.push(
    renderCaseDemo(i + 1, c.title, await runCaseDemo(join(fixtures, c.dir), providerFor(llm))),
  );
}
const markdown = sections.join("\n");

await mkdir(out, { recursive: true });
await writeFile(join(out, "demo.md"), markdown);
console.log(markdown);
console.log(`Wrote ${join(out, "demo.md")}`);
