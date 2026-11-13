import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LlmProvider } from "@valwell/agent";
import { describe, expect, it } from "vitest";
import { providerFor, runCaseDemo } from "./case-demo.js";

const DIR = join(import.meta.dirname, "../../../data/fixtures/demo");
const CASES = [
  "1-normal-repair",
  "2-price-entry-error",
  "3-markup-over-cap",
  "4-unapproved-extra-work",
];
const run = (name: string) => runCaseDemo(join(DIR, name), providerFor("offline"));

async function fixtureFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of CASES)
    for (const f of await readdir(join(DIR, c)))
      out[`${c}/${f}`] = await readFile(join(DIR, c, f), "utf8");
  return out;
}

describe("LLM orchestration of the four demo cases (offline)", () => {
  it("every case enters the tool loop and finishes with a disposition matching tool results", async () => {
    const before = await fixtureFiles();
    for (const name of CASES) {
      const r = await run(name);
      const last = r.runs.at(-1);
      expect(r.runs[0]?.trace.slice(0, 2).map((t) => t.tool)).toEqual([
        "validate_records",
        "reconcile_invoice",
      ]);
      expect(last?.status).toBe("DISPOSITION_ACCEPTED");
      expect(last?.disposition?.facts.portal).toBe(
        r.state.portalDecision?.status ?? "NOT_SUBMITTED",
      );
      for (const id of last?.disposition?.evidence_ids ?? [])
        expect(r.state.evidence.has(id)).toBe(true);
    }
    expect(await fixtureFiles()).toEqual(before); // source JSON untouched
  });

  it("case 1: no correction; the unchanged invoice passes the simulated portal", async () => {
    const r = await run("1-normal-repair");
    expect(r.runs).toHaveLength(1);
    expect(r.state.draft).toMatchObject({ status: "READY", changes: [], held: [] });
    expect(r.runs[0]?.disposition?.outcome).toBe("NO_CORRECTION_REQUIRED");
  });

  it("case 2: waits for a simulated human acceptance, then resumes and completes", async () => {
    const r = await run("2-price-entry-error");
    expect(r.runs.map((x) => x.disposition?.outcome)).toEqual([
      "AWAITING_HUMAN_ACCEPTANCE",
      "CORRECTED_AND_VALIDATED",
    ]);
    expect(r.state.humanEvents).toEqual([
      "Simulated human reviewer accepted F-0001 (Reprice LAB-TECH to $95.00 (v2))",
    ]);
    expect(r.state.draft?.totals).toEqual({
      original: 198_400,
      held: 0,
      draft: 220_000,
      corrections: 21_600,
    });
  });

  it("cases 3 and 4: corrected by code, or held at the original amount with a request drafted", async () => {
    expect((await run("3-markup-over-cap")).state.draft?.totals.corrections).toBe(-6_000);
    const four = await run("4-unapproved-extra-work");
    expect(four.state.draft?.held.map((l) => [l.id, l.amount])).toEqual([["INV-D4-L5", 44_000]]);
    expect(four.state.changeOrderRequests).toHaveLength(1);
    expect(four.original.portal).toMatchObject({
      status: "REJECTED",
      reasonCode: "UNAPPROVED_SCOPE",
    });
  });

  it("live mode uses one provider for all cases; a failed run is reported, not resumed or replaced", async () => {
    expect(providerFor("live")("1-normal-repair", 0)).toMatchObject({ mode: "live" });
    const failing = (): LlmProvider => ({
      mode: "live",
      model: "test-model",
      open: () => ({
        start: () => Promise.reject(new Error("401 invalid x-api-key")),
        reply: () => Promise.reject(new Error("x")),
      }),
    });
    const r = await runCaseDemo(join(DIR, "2-price-entry-error"), failing);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({
      status: "PROVIDER_FAILURE",
      mode: "live",
      disposition: null,
    });
    expect(r.state).toMatchObject({ draft: null, portalDecision: null, humanEvents: [] });
  });
});
