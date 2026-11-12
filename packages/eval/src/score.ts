import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FaultLabel, type Finding, FrictionCode } from "@valwell/domain";
import { z } from "zod";

/** Ground truth. Only the evaluation harness reads this file. */
export async function loadFaultLabels(batchDir: string): Promise<FaultLabel[]> {
  const raw: unknown = JSON.parse(await readFile(join(batchDir, "fault_labels.json"), "utf8"));
  return z.array(FaultLabel).parse(raw);
}

export interface CodeScore {
  code: FrictionCode | "ALL";
  labels: number;
  findings: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** null when there are no findings (precision undefined). */
  precision: number | null;
  /** null when there are no labels (recall undefined). */
  recall: number | null;
}

export interface ScoreResult {
  byCode: CodeScore[];
  overall: CodeScore;
  /** Findings with no matching label, and labels no finding matched. */
  unmatchedFindings: Finding[];
  missedLabels: FaultLabel[];
}

/** Same job, same friction code, same line (invoice line, else work-order line). */
const key = (x: Pick<Finding, "jobId" | "frictionCode" | "invoiceLineId" | "workOrderLineId">) =>
  `${x.jobId}|${x.frictionCode}|${x.invoiceLineId ?? `wo:${x.workOrderLineId}`}`;

function scoreOf(code: CodeScore["code"], labels: number, findings: number, tp: number): CodeScore {
  return {
    code,
    labels,
    findings,
    truePositives: tp,
    falsePositives: findings - tp,
    falseNegatives: labels - tp,
    precision: findings === 0 ? null : tp / findings,
    recall: labels === 0 ? null : tp / labels,
  };
}

/** Match findings to labels one-to-one and compute precision and recall per friction code. */
export function scoreFindings(
  findings: readonly Finding[],
  labels: readonly FaultLabel[],
): ScoreResult {
  const open = new Map<string, FaultLabel[]>();
  for (const l of labels) open.set(key(l), [...(open.get(key(l)) ?? []), l]);

  const matched: Finding[] = [];
  const unmatchedFindings: Finding[] = [];
  for (const f of findings) {
    const candidates = open.get(key(f));
    if (candidates && candidates.length > 0) {
      candidates.shift();
      matched.push(f);
    } else {
      unmatchedFindings.push(f);
    }
  }
  const missedLabels = [...open.values()].flat();

  const byCode = FrictionCode.options.map((code) =>
    scoreOf(
      code,
      labels.filter((l) => l.frictionCode === code).length,
      findings.filter((f) => f.frictionCode === code).length,
      matched.filter((f) => f.frictionCode === code).length,
    ),
  );
  const overall = scoreOf("ALL", labels.length, findings.length, matched.length);
  return { byCode, overall, unmatchedFindings, missedLabels };
}
