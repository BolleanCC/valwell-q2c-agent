import type { InvoiceLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { applyFindings } from "../fix.js";
import { case4Scope } from "../testing/case4.js";
import { draftChangeOrderRequest, LIMITS, type ModelTurn } from "./loop.js";
import { callTools, scriptedProvider } from "./scripted.js";
import type { DraftingScope } from "./tools.js";

const GOOD_DRAFT = {
  workSummary: "The valve stem was replaced during the repair.",
  businessReason: "The technician found the stem bent beyond tolerance; the gate would not seat.",
  evidenceIds: ["F-0001", "WO-D4-L5", "WO-D4-N1", "WO-D4-TDI-2"],
  missingInformation: [],
  customerRequestText:
    "During the repair of your gate valve we found the stem bent and replaced it. Please review this change order.",
};
const submit = (input: unknown): ModelTurn => ({
  stopReason: "tool_use",
  text: "",
  toolCalls: [{ id: "submit", name: "submit_change_order_draft", input }],
});
const INVESTIGATE = [
  callTools(
    ["get_finding_details", { finding_id: "F-0001" }],
    ["get_work_order", { job_id: "JOB-D4" }],
  ),
  callTools(
    ["get_effective_quote", { job_id: "JOB-D4" }],
    ["get_change_orders", { job_id: "JOB-D4" }],
  ),
];

/** Case 4 scope plus the line the deterministic draft actually held. */
async function setup(): Promise<{ scope: DraftingScope; held: InvoiceLine }> {
  const scope = await case4Scope();
  const draft = applyFindings(scope.ctx.invoice, [scope.finding], { status: "COMPLETE" });
  const [held] = draft.held;
  if (!held) throw new Error("case 4 holds no line");
  return { scope, held };
}

describe("draftChangeOrderRequest (offline, scripted provider)", () => {
  it("investigates through tools, then produces a validated draft with deterministic amounts", async () => {
    const { scope, held } = await setup();
    const before = { ctx: structuredClone(scope.ctx), held: structuredClone(held) };
    const { provider, received } = scriptedProvider([...INVESTIGATE, submit(GOOD_DRAFT)]);
    const r = await draftChangeOrderRequest(scope, held, provider);

    expect(r).toMatchObject({
      status: "DRAFTED",
      mode: "offline",
      problems: [],
      content: GOOD_DRAFT,
    });
    expect(r.trace.map((t) => t.tool)).toEqual([
      "get_finding_details",
      "get_work_order",
      "get_effective_quote",
      "get_change_orders",
      "submit_change_order_draft",
    ]);
    expect(received).toHaveLength(2); // tool results really went back to the "model"
    expect(r.request).toContain(
      "Amount (from the held invoice line, deterministic): 1 × $440.00 = $440.00",
    );
    // Nothing was released or modified: the line stays held, records unchanged.
    expect(held).toEqual(before.held);
    expect(scope.ctx).toEqual(before.ctx);
  });

  it("rejects a draft submitted before any evidence was retrieved", async () => {
    const { scope, held } = await setup();
    const r = await draftChangeOrderRequest(
      scope,
      held,
      scriptedProvider([submit(GOOD_DRAFT)]).provider,
    );
    expect(r.status).toBe("INVALID_OUTPUT");
    expect(r.problems[0]).toContain("evidence not returned by any tool in this run: F-0001");
    expect(r.request).toBeNull();
  });

  it("stops at the turn limit and at the tool-call limit", async () => {
    const { scope, held } = await setup();
    const forever = Array.from({ length: 10 }, () =>
      callTools(["get_work_order", { job_id: "JOB-D4" }]),
    );
    const turns = await draftChangeOrderRequest(scope, held, scriptedProvider(forever).provider);
    expect(turns).toMatchObject({
      status: "LIMIT_REACHED",
      problems: ["no draft submitted within 6 model turns"],
    });
    expect(turns.trace).toHaveLength(LIMITS.maxTurns);

    const flood = callTools(
      ...Array.from(
        { length: 11 },
        () => ["get_change_orders", { job_id: "JOB-D4" }] as [string, unknown],
      ),
    );
    const calls = await draftChangeOrderRequest(scope, held, scriptedProvider([flood]).provider);
    expect(calls).toMatchObject({
      status: "LIMIT_REACHED",
      problems: ["more than 10 tool calls requested"],
    });
  });

  it("reports provider failure and timeout without a draft and keeps the line held", async () => {
    const { scope, held } = await setup();
    const failed = await draftChangeOrderRequest(
      scope,
      held,
      scriptedProvider([INVESTIGATE[0] as ModelTurn, new Error("503 overloaded")]).provider,
    );
    expect(failed).toMatchObject({
      status: "PROVIDER_FAILURE",
      problems: ["503 overloaded"],
      request: null,
    });
    expect(failed.amounts.amount).toBe(44_000); // the held amount is still reported

    const slow = await draftChangeOrderRequest(scope, held, scriptedProvider(["hang"]).provider, {
      ...LIMITS,
      timeoutMs: 20,
    });
    expect(slow).toMatchObject({
      status: "PROVIDER_FAILURE",
      problems: ["provider timed out after 20 ms"],
    });
  });
});
