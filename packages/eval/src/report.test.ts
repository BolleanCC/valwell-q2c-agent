import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBatch } from "./experiment.js";
import { recallFailures, renderEvaluation } from "./report.js";
import type { CodeScore } from "./score.js";

const score = (code: CodeScore["code"], recall: number | null): CodeScore => ({
  code,
  labels: recall === null ? 0 : 10,
  findings: 10,
  truePositives: 0,
  falsePositives: 0,
  falseNegatives: 0,
  precision: 1,
  recall,
});

describe("recallFailures", () => {
  it("flags codes below the threshold and ignores codes without labels", () => {
    const scores = [score("A1", 0.95), score("A3", 0.8), score("B1", null)];
    expect(recallFailures(scores, 0.9).map((s) => s.code)).toEqual(["A3"]);
    expect(recallFailures(scores, 0.5)).toEqual([]);
  });
});

describe("renderEvaluation", () => {
  it("renders detection, experiment and amount sections for the fixture", async () => {
    const dir = join(import.meta.dirname, "../../../data/fixtures/seed-42");
    const md = renderEvaluation("seed-42", await evaluateBatch(dir));
    expect(md).toContain("# Evaluation: seed-42");
    expect(md).toMatch(/\| A1 \| 7 \| 7 \| 7 \| 0 \| 0 \| 100\.0% \| 100\.0% \|/);
    expect(md).toContain("| Run 0: baseline (no agent) | 40 | 21 | 52.5% |");
    expect(md).toContain("Over-billing removed: **$");
    expect(md).not.toContain("## Mismatches");
  });
});
