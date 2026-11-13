#!/usr/bin/env node
/**
 * pnpm demo [-- --out data/runs/demo]
 *
 * Runs the four fixed demo cases in data/fixtures/demo in a stable order,
 * prints the walkthrough and writes demo.md. Offline: no generator, no fault
 * labels, no network. Source fixtures are only read.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_CASES, DEMO_HEADER, renderDemoCase, runDemoCase } from "./demo.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { out: { type: "string" } },
});
const out = values.out ?? join("data", "runs", "demo");
const fixtures = join("data", "fixtures", "demo");

const sections = [DEMO_HEADER];
for (const [i, c] of DEMO_CASES.entries()) {
  sections.push(renderDemoCase(i + 1, c.title, await runDemoCase(join(fixtures, c.dir))));
}
const markdown = sections.join("\n");

await mkdir(out, { recursive: true });
await writeFile(join(out, "demo.md"), markdown);
console.log(markdown);
console.log(`Wrote ${join(out, "demo.md")}`);
