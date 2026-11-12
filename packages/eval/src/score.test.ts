import { join } from "node:path";
import { openBatchSources, runAgent } from "@valwell/agent";
import { FaultLabel, Finding } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { loadFaultLabels, scoreFindings } from "./score.js";

const label = (id: string, code: string, line: string) =>
  FaultLabel.parse({
    id,
    jobId: "JOB-1",
    invoiceId: "INV-1",
    frictionCode: code,
    invoiceLineId: line,
    workOrderLineId: null,
    description: "x",
    amountImpact: 100,
  });

const finding = (id: string, code: string, line: string | null, woLine: string | null = null) =>
  Finding.parse({
    id,
    jobId: "JOB-1",
    invoiceId: "INV-1",
    frictionCode: code,
    invoiceLineId: line,
    workOrderLineId: woLine,
    message: "x",
    evidence: [{ kind: "RULE", id: "R" }],
    suggestion: { action: "REPRICE_LINE", summary: "x", amountDelta: 0 },
    confidence: 0.9,
    route: "REVIEW",
    status: "OPEN",
  });

describe("scoreFindings", () => {
  it("computes per-code precision and recall from one-to-one matches", () => {
    const labels = [
      label("L1", "A1", "IL-1"),
      label("L2", "A1", "IL-2"),
      label("L3", "B1", "IL-3"),
    ];
    const findings = [
      finding("F1", "A1", "IL-1"), // TP
      finding("F2", "A1", "IL-1"), // duplicate → FP
      finding("F3", "A3", "IL-2"), // wrong code → FP
      finding("F4", "B1", "IL-3"), // TP
    ];
    const r = scoreFindings(findings, labels);
    expect(r.byCode.find((s) => s.code === "A1")).toMatchObject({
      labels: 2,
      findings: 2,
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0.5,
      recall: 0.5,
    });
    expect(r.byCode.find((s) => s.code === "A3")).toMatchObject({ precision: 0, recall: null });
    expect(r.byCode.find((s) => s.code === "B1")).toMatchObject({ precision: 1, recall: 1 });
    expect(r.overall).toMatchObject({ truePositives: 2, precision: 0.5, recall: 2 / 3 });
    expect(r.missedLabels.map((l) => l.id)).toEqual(["L2"]);
    expect(r.unmatchedFindings.map((f) => f.id)).toEqual(["F2", "F3"]);
  });

  it("reports undefined precision when there are no findings", () => {
    const r = scoreFindings([], [label("L1", "A1", "IL-1")]);
    expect(r.overall).toMatchObject({ precision: null, recall: 0 });
  });
});

describe("agent on the committed fixture", () => {
  it("scores the agent's findings against the fixture's labels", async () => {
    const dir = join(import.meta.dirname, "../../../data/fixtures/seed-42");
    const run = runAgent(await openBatchSources(dir));
    const r = scoreFindings(run.findings, await loadFaultLabels(dir));
    for (const s of r.byCode) {
      expect(s.recall, s.code).toBeGreaterThanOrEqual(0.9);
      expect(s.precision, s.code).toBeGreaterThanOrEqual(0.9);
    }
  });
});
