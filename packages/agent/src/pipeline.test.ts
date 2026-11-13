import { join } from "node:path";
import { fromCents, InvoiceLine, WorkOrderLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { openBatchSources } from "./adapters/json-batch.js";
import { routeFinding } from "./nodes/route.js";
import { runAgent, runPipeline } from "./pipeline.js";
import { buildContext } from "./testing/build-context.js";

const FIXTURE = join(import.meta.dirname, "../../../data/fixtures/seed-42");

describe("routeFinding", () => {
  it("auto-fixes confident price findings and blocks scope changes", () => {
    expect(routeFinding({ frictionCode: "A1", confidence: 0.97 })).toBe("AUTO_FIX");
    expect(routeFinding({ frictionCode: "A1", confidence: 0.9 })).toBe("REVIEW");
    expect(routeFinding({ frictionCode: "A3", confidence: 0.95 })).toBe("AUTO_FIX");
    expect(routeFinding({ frictionCode: "B1", confidence: 1 })).toBe("BLOCK");
  });

  it("follows a custom policy", () => {
    const strict = {
      A1: { otherwise: "REVIEW" as const },
      A3: { otherwise: "REVIEW" as const },
      B1: { otherwise: "REVIEW" as const },
    };
    expect(routeFinding({ frictionCode: "A1", confidence: 1 }, strict)).toBe("REVIEW");
  });
});

describe("runPipeline", () => {
  it("returns no findings for a clean job", () => {
    const { reviews, findings, drafts } = runPipeline([buildContext()]);
    expect(reviews).toEqual([
      { jobId: "JOB-T", invoiceId: "INV-T", status: "COMPLETE", issues: [] },
    ]);
    expect(findings).toEqual([]);
    expect(drafts).toMatchObject([{ jobId: "JOB-T", status: "READY", changes: [], held: [] }]);
  });

  it("runs every detector, numbers findings and routes them", () => {
    const ctx = buildContext();
    const labour = ctx.invoice.lines.find((l) => l.id === "IL-2");
    if (!labour) throw new Error("IL-2");
    labour.unitPrice = fromCents(9_000);
    labour.amount = fromCents(54_000);
    ctx.workOrder.lines.push(
      WorkOrderLine.parse({
        id: "WL-9",
        kind: "LABOUR",
        itemCode: "LAB-WELD",
        description: "W",
        hours: 1,
      }),
    );
    ctx.invoice.lines.push(
      InvoiceLine.parse({
        id: "IL-9",
        itemCode: "LAB-WELD",
        description: "W",
        kind: "LABOUR",
        qty: 1,
        unitPrice: 13_600,
        amount: 13_600,
      }),
    );
    const { findings } = runPipeline([ctx]);
    expect(findings.map((f) => [f.id, f.frictionCode, f.route])).toEqual([
      ["F-0001", "A1", "AUTO_FIX"],
      ["F-0002", "B1", "BLOCK"],
    ]);
  });
});

describe("runPipeline with unresolved alignment", () => {
  it("sends duplicate item codes with different costs to review, never to a price fix", () => {
    const ctx = buildContext();
    ctx.workOrder.lines.push(
      WorkOrderLine.parse({
        id: "WL-3b",
        kind: "PART",
        itemCode: "PART-SEAT",
        description: "Seat",
        qty: 2,
        unitCost: 15_000,
      }),
    );
    const seat = ctx.invoice.lines.find((l) => l.id === "IL-3");
    if (!seat) throw new Error("IL-3");
    seat.unitPrice = fromCents(25_000); // above the cap on either cost
    seat.amount = fromCents(50_000);
    const { reviews, findings, drafts } = runPipeline([ctx]);
    expect(findings.filter((f) => f.invoiceLineId === "IL-3")).toEqual([]);
    expect(drafts).toMatchObject([{ status: "INPUT_NEEDS_REVIEW", invoice: null }]);
    expect(reviews).toMatchObject([
      { status: "NEEDS_REVIEW", issues: [{ code: "AMBIGUOUS_MATCH", invoiceLineId: "IL-3" }] },
    ]);
  });
});

describe("runAgent on the fixture batch", () => {
  it("checks every job, finds all three friction codes and is deterministic", async () => {
    const sources = await openBatchSources(FIXTURE);
    const run = runAgent(sources);
    expect(run.jobsChecked).toBe(40);
    expect(run.reviews.every((r) => r.status === "COMPLETE")).toBe(true);
    expect(new Set(run.findings.map((f) => f.frictionCode))).toEqual(new Set(["A1", "A3", "B1"]));
    expect(runAgent(sources)).toEqual(run);
  });
});
