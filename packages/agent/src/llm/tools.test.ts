import { describe, expect, it } from "vitest";
import { case4Scope } from "../testing/case4.js";
import { runTool, TOOL_SPECS } from "./tools.js";

const evidenceIds = (outcome: ReturnType<typeof runTool>) =>
  outcome.ok ? outcome.evidence.map((e) => `${e.source}:${e.id}`) : [];

describe("read-only drafting tools", () => {
  it("offers exactly four tools with strict input schemas", () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([
      "get_finding_details",
      "get_work_order",
      "get_effective_quote",
      "get_change_orders",
    ]);
    for (const t of TOOL_SPECS) expect(t.input_schema.additionalProperties).toBe(false);
  });

  it("returns job records with stable evidence ids and no prices or costs", async () => {
    const scope = await case4Scope();
    const wo = runTool(scope, "get_work_order", { job_id: "JOB-D4" });
    expect(evidenceIds(wo)).toEqual(
      expect.arrayContaining([
        "WORK_ORDER_LINE:WO-D4-L5",
        "TDI_FINDING:WO-D4-TDI-2",
        "TECHNICIAN_NOTE:WO-D4-N1",
      ]),
    );
    expect(JSON.stringify(wo)).not.toMatch(/unitCost|unitPrice|amount/);
    expect(evidenceIds(runTool(scope, "get_finding_details", { finding_id: "F-0001" }))).toEqual([
      "FINDING:F-0001",
      "INVOICE_LINE:INV-D4-L5",
    ]);
    expect(evidenceIds(runTool(scope, "get_effective_quote", { job_id: "JOB-D4" }))).toContain(
      "QUOTE_LINE:Q-D4-REP-R1-L2",
    );
    expect(runTool(scope, "get_change_orders", { job_id: "JOB-D4" })).toMatchObject({
      ok: true,
      data: { changeOrders: [] },
    });
  });

  it("rejects invalid arguments and unknown tools", async () => {
    const scope = await case4Scope();
    expect(runTool(scope, "get_work_order", {})).toEqual({
      ok: false,
      error:
        "invalid arguments for get_work_order: job_id Invalid input: expected string, received undefined",
    });
    expect(runTool(scope, "get_work_order", { job_id: "JOB-D4", all: true }).ok).toBe(false);
    expect(runTool(scope, "update_invoice", { job_id: "JOB-D4" })).toEqual({
      ok: false,
      error: "unknown tool update_invoice",
    });
  });

  it("rejects identifiers outside the current job", async () => {
    const scope = await case4Scope();
    expect(runTool(scope, "get_change_orders", { job_id: "JOB-D1" })).toEqual({
      ok: false,
      error: "job JOB-D1 is outside this task's scope (JOB-D4)",
    });
    expect(runTool(scope, "get_finding_details", { finding_id: "F-0002" }).ok).toBe(false);
  });

  it("never changes the source records, even if a caller mutates a result", async () => {
    const scope = await case4Scope();
    const before = structuredClone(scope.ctx);
    const wo = runTool(scope, "get_work_order", { job_id: "JOB-D4" });
    if (wo.ok) (wo.data as { lines: unknown[] }).lines.length = 0;
    expect(scope.ctx).toEqual(before);
  });
});
