import { join } from "node:path";
import type { LlmProvider } from "@valwell/agent";
import { describe, expect, it } from "vitest";
import { providerFor, runCaseDemo } from "./case-demo.js";
import { DEMO_CASES, renderCaseDemo } from "./case-demo-render.js";

const DIR = join(import.meta.dirname, "../../../data/fixtures/demo");

async function renderAll(): Promise<string> {
  const parts: string[] = [];
  for (const [i, c] of DEMO_CASES.entries()) {
    parts.push(
      renderCaseDemo(i + 1, c.title, await runCaseDemo(join(DIR, c.dir), providerFor("offline"))),
    );
  }
  return parts.join("\n");
}

describe("orchestrated demo walkthrough", () => {
  it("renders identically on repeated offline runs and labels them simulated", async () => {
    const md = await renderAll();
    expect(await renderAll()).toBe(md);
    expect(
      md.match(/OFFLINE — simulated LLM behaviour from a fixed script, not a model run/g),
    ).toHaveLength(5);
  });

  it("shows tool traces, verified dispositions, the case 2 human event and held amounts", async () => {
    const md = await renderAll();
    expect(md).toContain(
      'reconcile_invoice {"job_id":"JOB-D3"} → ok: review COMPLETE; findings: F-0001 A3 AUTO_FIX OPEN',
    );
    expect(md).toContain(
      "- Disposition (verified against the case state): **NO_CORRECTION_REQUIRED**",
    );
    expect(md).toContain(
      "- Human event (simulated by the application, outside the model): Simulated human reviewer accepted F-0001",
    );
    expect(md).toContain("  - Draft action: INV-D3-L3 $500.00 → $440.00");
    expect(md).toContain(
      "  - Held (not submitted, not approved, not paid): INV-D4-L5 PART-STEM $440.00",
    );
    expect(md).toContain(
      "    > Amount (from the held invoice line, deterministic): 1 × $440.00 = $440.00",
    );
  });

  it("says plainly when live orchestration did not complete, keeping recorded facts", async () => {
    const failing = (): LlmProvider => ({
      mode: "live",
      model: "test-model",
      open: () => ({
        start: () => Promise.reject(new Error("timed out")),
        reply: () => Promise.reject(new Error("x")),
      }),
    });
    const md = renderCaseDemo(
      4,
      "Unapproved additional work",
      await runCaseDemo(join(DIR, "4-unapproved-extra-work"), failing),
    );
    expect(md).toContain("LIVE — test-model via the Anthropic API");
    expect(md).toContain(
      "**LLM orchestration did not complete** (PROVIDER_FAILURE): timed out. No disposition.",
    );
    expect(md).toContain("- Case state recorded by the tools before orchestration stopped:");
    expect(md).not.toContain("Disposition (verified");
  });
});
