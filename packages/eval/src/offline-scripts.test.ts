import { join } from "node:path";
import {
  acceptFinding,
  collectJobContexts,
  createCaseState,
  openBatchSources,
  runCaseWorkflow,
  scriptedProvider,
} from "@valwell/agent";
import { openPortal } from "@valwell/mock-systems";
import { describe, expect, it } from "vitest";
import { offlineScript } from "./offline-scripts.js";

const DIR = join(import.meta.dirname, "../../../data/fixtures/demo");

async function stateFor(name: string) {
  const [ctx] = collectJobContexts(await openBatchSources(join(DIR, name))).contexts;
  if (!ctx) throw new Error(name);
  return createCaseState(ctx, await openPortal(join(DIR, name)));
}
const offline = (name: string, phase = 0) => scriptedProvider(offlineScript(name, phase)).provider;

describe("offline scripts pass the same verification as a live model would", () => {
  it.each([
    ["1-normal-repair", "NO_CORRECTION_REQUIRED"],
    ["3-markup-over-cap", "CORRECTED_AND_VALIDATED"],
    ["4-unapproved-extra-work", "PARTIAL_SUBMISSION_WITH_HOLD"],
  ])("%s ends in a verified %s disposition", async (name, outcome) => {
    const run = await runCaseWorkflow(await stateFor(name), offline(name));
    expect(run.trace.every((t) => t.ok)).toBe(true);
    expect(run).toMatchObject({
      status: "DISPOSITION_ACCEPTED",
      mode: "offline",
      disposition: { outcome },
    });
  });

  it("case 2 waits for the human event and then completes in the same case state", async () => {
    const s = await stateFor("2-price-entry-error");
    const first = await runCaseWorkflow(s, offline("2-price-entry-error", 0));
    expect(first.disposition?.outcome).toBe("AWAITING_HUMAN_ACCEPTANCE");
    acceptFinding(s, "F-0001", "Simulated reviewer");
    const second = await runCaseWorkflow(s, offline("2-price-entry-error", 1), {
      humanEvent: s.humanEvents[0] ?? "",
    });
    expect(second.disposition).toMatchObject({
      outcome: "CORRECTED_AND_VALIDATED",
      facts: { portal: "APPROVED", totals: { original: 198_400, draft: 220_000 } },
    });
  });

  it("case 4 keeps the unapproved amount held and the request carries code-inserted amounts", async () => {
    const s = await stateFor("4-unapproved-extra-work");
    await runCaseWorkflow(s, offline("4-unapproved-extra-work"));
    expect(s.draft?.totals).toEqual({
      original: 264_000,
      held: 44_000,
      draft: 220_000,
      corrections: 0,
    });
    expect(s.changeOrderRequests[0]?.request).toContain(
      "Amount (from the held invoice line, deterministic): 1 × $440.00 = $440.00",
    );
  });

  it("case 2's second script fails verification if the human event never happened", async () => {
    const s = await stateFor("2-price-entry-error");
    const run = await runCaseWorkflow(s, offline("2-price-entry-error", 1));
    expect(run.trace.find((t) => t.tool === "prepare_draft")).toMatchObject({ ok: false });
    expect(run.status).not.toBe("DISPOSITION_ACCEPTED");
  });
});
