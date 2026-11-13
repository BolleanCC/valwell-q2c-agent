import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_CASES, renderDemoCase, runDemoCase } from "./demo.js";

const ROOT = join(import.meta.dirname, "../../../data/fixtures/demo");

async function renderAll(): Promise<string> {
  const parts: string[] = [];
  for (const [i, c] of DEMO_CASES.entries()) {
    parts.push(renderDemoCase(i + 1, c.title, await runDemoCase(join(ROOT, c.dir))));
  }
  return parts.join("\n");
}

async function snapshotFixtures(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const c of DEMO_CASES) {
    for (const f of await readdir(join(ROOT, c.dir))) {
      files[`${c.dir}/${f}`] = await readFile(join(ROOT, c.dir, f), "utf8");
    }
  }
  return files;
}

describe("demo walkthrough", () => {
  it("is deterministic, label-free and leaves the source fixtures untouched", async () => {
    const before = await snapshotFixtures();
    const first = await renderAll();
    expect(await renderAll()).toBe(first);
    expect(await snapshotFixtures()).toEqual(before);
    expect(Object.keys(before).some((f) => f.includes("fault_labels"))).toBe(false);
  });

  it("shows the acceptance step for the price entry error before and after", async () => {
    const md = await renderAll();
    expect(md).toContain("- Before acceptance (finding OPEN): **AWAITING_REVIEW**");
    expect(md).toContain(
      "- After a simulated reviewer accepts it (a draft correction, not customer approval): **READY**",
    );
    expect(md).toContain("  - Draft action: INV-D2-L2 $354.00 → $570.00");
    expect(md).toContain(
      "  - Totals: original $1,984.00 − held $0.00 + corrections +$216.00 = draft $2,200.00",
    );
  });

  it("keeps the held amount visible and never calls it approved", async () => {
    const md = await renderAll();
    expect(md).toContain(
      "  - Held (not submitted, not approved, not paid): INV-D4-L5 PART-STEM $440.00",
    );
    expect(md).toContain(
      "  - Totals: original $2,640.00 − held $440.00 + corrections $0.00 = draft $2,200.00",
    );
    expect(md).toContain("the held $440.00 is still unresolved");
    expect(md).toContain("  - Draft action: INV-D3-L3 $500.00 → $440.00");
  });
});
