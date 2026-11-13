import { describe, expect, it } from "vitest";
import { demoCaseState } from "../testing/demo-case.js";
import { getChangeOrders, getEffectiveQuote, getWorkOrder, type ToolOutcome } from "./tools.js";

const ids = (o: ToolOutcome) => (o.ok ? o.evidence.map((e) => `${e.source}:${e.id}`) : []);

describe("read-only record helpers", () => {
  it("return job records with stable evidence ids and no prices or costs", async () => {
    const { ctx } = await demoCaseState("4-unapproved-extra-work");
    const wo = getWorkOrder(ctx);
    expect(ids(wo)).toEqual(
      expect.arrayContaining([
        "WORK_ORDER_LINE:WO-D4-L5",
        "TDI_FINDING:WO-D4-TDI-2",
        "TECHNICIAN_NOTE:WO-D4-N1",
      ]),
    );
    expect(JSON.stringify(wo)).not.toMatch(/unitCost|unitPrice|amount/);
    expect(ids(getEffectiveQuote(ctx))).toContain("QUOTE_LINE:Q-D4-REP-R1-L2");
    expect(getChangeOrders(ctx)).toMatchObject({ ok: true, data: { changeOrders: [] } });
  });

  it("return copies, so mutating a result never changes the source records", async () => {
    const { ctx } = await demoCaseState("4-unapproved-extra-work");
    const before = structuredClone(ctx);
    const wo = getWorkOrder(ctx);
    if (wo.ok) (wo.data as { lines: unknown[] }).lines.length = 0;
    expect(ctx).toEqual(before);
  });
});
