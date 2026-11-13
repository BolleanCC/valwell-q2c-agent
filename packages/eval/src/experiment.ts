import { applyFindings, openBatchSources, runAgent } from "@valwell/agent";
import {
  add,
  type Finding,
  fromCents,
  type Invoice,
  type Money,
  type Route,
} from "@valwell/domain";
import { type CustomerPortal, openBillingStore, openPortal } from "@valwell/mock-systems";
import { loadFaultLabels, type ScoreResult, scoreFindings } from "./score.js";

export interface RunOutcome {
  name: string;
  /** Invoices sent to the portal (fully held invoices are not sent). */
  submitted: number;
  approved: number;
  /** Approved / total invoices in the batch. */
  firstPassAcceptance: number;
  /** Invoices with every line held pending a change order. */
  fullyHeld: number;
  rejectionReasons: Record<string, number>;
}

/** Actual results of the drafts (not summed proposals), so nothing is counted twice. */
export interface AmountSummary {
  /** Over-billing removed by repricing (positive number). */
  overbillingRemoved: Money;
  /** Under-billing recovered by repricing to the contract rate. */
  underbillingRecovered: Money;
  /** Original amounts of held lines: not submitted and not approved. */
  heldPendingChangeOrder: Money;
}

export interface ExperimentResult {
  invoices: number;
  runs: RunOutcome[];
  amounts: AmountSummary;
}

function submitAll(
  name: string,
  invoices: readonly Invoice[],
  portal: CustomerPortal,
  prepare: (invoice: Invoice) => Invoice | null,
): RunOutcome {
  const reasons: Record<string, number> = {};
  let submitted = 0;
  let approved = 0;
  let fullyHeld = 0;
  for (const original of invoices) {
    const invoice = prepare(original);
    if (!invoice) {
      fullyHeld++;
      continue;
    }
    submitted++;
    const decision = portal.submit(invoice);
    if (decision.status === "APPROVED") approved++;
    else reasons[decision.reasonCode] = (reasons[decision.reasonCode] ?? 0) + 1;
  }
  const firstPassAcceptance = invoices.length === 0 ? 0 : approved / invoices.length;
  return { name, submitted, approved, firstPassAcceptance, fullyHeld, rejectionReasons: reasons };
}

/**
 * Run 0 submits invoices straight to the portal. Run 1 applies only what the
 * agent does unattended (auto-fixes, plus holding blocked lines). Run 2
 * assumes a reviewer accepts every suggestion, including REVIEW findings.
 */
export function runExperiment(
  invoices: readonly Invoice[],
  findings: readonly Finding[],
  portal: CustomerPortal,
): ExperimentResult {
  const unattended: Route[] = ["AUTO_FIX", "BLOCK"];
  const runs = [
    submitAll("Run 0: baseline (no agent)", invoices, portal, (i) => i),
    submitAll(
      "Run 1: agent, unattended (auto-fix + block)",
      invoices,
      portal,
      (i) => applyFindings(i, findings, unattended).invoice,
    ),
    submitAll(
      "Run 2: agent, reviewer accepts all",
      invoices,
      portal,
      (i) => applyFindings(i, findings).invoice,
    ),
  ];

  const drafts = invoices.map((i) => applyFindings(i, findings));
  const lineDeltas = drafts.flatMap((d) => d.changes.map((c) => c.after.amount - c.before.amount));
  const sum = (xs: number[]) => fromCents(xs.reduce((a, b) => a + b, 0));
  return {
    invoices: invoices.length,
    runs,
    amounts: {
      overbillingRemoved: sum(lineDeltas.filter((d) => d < 0).map((d) => -d)),
      underbillingRecovered: sum(lineDeltas.filter((d) => d > 0)),
      heldPendingChangeOrder: add(...drafts.map((d) => d.totals.held)),
    },
  };
}

export interface BatchEvaluation {
  score: ScoreResult;
  experiment: ExperimentResult;
}

/** Run the agent on a batch, score it against the labels and run the portal experiment. */
export async function evaluateBatch(batchDir: string): Promise<BatchEvaluation> {
  const run = runAgent(await openBatchSources(batchDir));
  const [labels, billing, portal] = await Promise.all([
    loadFaultLabels(batchDir),
    openBillingStore(batchDir),
    openPortal(batchDir),
  ]);
  return {
    score: scoreFindings(run.findings, labels),
    experiment: runExperiment(billing.invoices(), run.findings, portal),
  };
}
