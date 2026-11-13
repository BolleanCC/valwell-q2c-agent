import type { InvoiceLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { applyFindings } from "../fix.js";
import { case4Scope } from "../testing/case4.js";
import { draftChangeOrderRequest, LIMITS, type ModelTurn } from "./loop.js";
import { offlineDraftingProvider } from "./offline-script.js";
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

describe("draftChangeOrderRequest failure paths", () => {
  it("returns tool errors to the model for bad arguments, unknown tools and other jobs", async () => {
    const { scope, held } = await setup();
    const { provider, received } = scriptedProvider([
      callTools(
        ["get_work_order", { job: "JOB-D4" }],
        ["delete_invoice", { job_id: "JOB-D4" }],
        ["get_change_orders", { job_id: "JOB-D1" }],
      ),
      ...INVESTIGATE,
      submit(GOOD_DRAFT),
    ]);
    const r = await draftChangeOrderRequest(scope, held, provider);
    expect(r.trace.slice(0, 3).map((t) => [t.tool, t.ok, t.summary])).toEqual([
      ["get_work_order", false, expect.stringContaining("invalid arguments for get_work_order")],
      ["delete_invoice", false, "unknown tool delete_invoice"],
      ["get_change_orders", false, "job JOB-D1 is outside this task's scope (JOB-D4)"],
    ]);
    expect(received[0]?.every((res) => res.isError)).toBe(true);
    expect(r.status).toBe("DRAFTED"); // the model recovered by calling the tools correctly
  });

  it("does not accept evidence from a rejected cross-job call", async () => {
    const { scope, held } = await setup();
    const r = await draftChangeOrderRequest(
      scope,
      held,
      scriptedProvider([
        ...INVESTIGATE,
        callTools(["get_work_order", { job_id: "JOB-D1" }]),
        submit({ ...GOOD_DRAFT, evidenceIds: [...GOOD_DRAFT.evidenceIds, "WO-D1-L1"] }),
      ]).provider,
    );
    expect(r).toMatchObject({
      status: "INVALID_OUTPUT",
      problems: ["evidence not returned by any tool in this run: WO-D1-L1"],
    });
  });

  it("rejects invalid structured output and output that names amounts or approval", async () => {
    const { scope, held } = await setup();
    const run = (draft: unknown) =>
      draftChangeOrderRequest(
        scope,
        held,
        scriptedProvider([...INVESTIGATE, submit(draft)]).provider,
      );
    expect((await run({ workSummary: "stem" })).status).toBe("INVALID_OUTPUT");
    const priced = await run({
      ...GOOD_DRAFT,
      customerRequestText: "Please pay $440.00 for the stem.",
    });
    expect(priced).toMatchObject({ status: "INVALID_OUTPUT", request: null });
    const approved = await run({ ...GOOD_DRAFT, workSummary: "The customer approved the stem." });
    expect(approved.problems).toContain("text claims approval, submission, payment or release");
  });

  it("ends without a draft when the model stops, refuses or runs out of tokens", async () => {
    const { scope, held } = await setup();
    const stop = (stopReason: string) =>
      draftChangeOrderRequest(
        scope,
        held,
        scriptedProvider([{ stopReason, text: "Here is my summary.", toolCalls: [] }]).provider,
      );
    expect(await stop("end_turn")).toMatchObject({
      status: "INVALID_OUTPUT",
      problems: ["the model stopped without submitting a draft"],
    });
    expect((await stop("refusal")).status).toBe("PROVIDER_FAILURE");
    expect((await stop("max_tokens")).problems).toEqual(["output token limit reached"]);
  });

  it("reports missing business justification instead of inventing one", async () => {
    const { scope, held } = await setup();
    // Same job, but with no technician note and no teardown finding on record.
    const bare = {
      ...scope,
      ctx: {
        ...scope.ctx,
        workOrder: { ...scope.ctx.workOrder, tdiFindings: [], technicianNotes: [] },
      },
    };
    const r = await draftChangeOrderRequest(bare, held, offlineDraftingProvider(bare));
    expect(r).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      problems: ["the records do not document a business reason"],
      content: { businessReason: null },
    });
    expect(r.request).toContain("Documented reason: not documented in the records");

    // A model that asserts a reason anyway, without citing a note or TDI finding, is rejected.
    const invented = await draftChangeOrderRequest(
      bare,
      held,
      scriptedProvider([
        ...INVESTIGATE,
        submit({ ...GOOD_DRAFT, evidenceIds: ["F-0001", "WO-D4-L5"] }),
      ]).provider,
    );
    expect(invented.problems).toEqual([
      "business reason does not cite a technician note or TDI finding",
    ]);
  });
});
