import {
  acceptAll,
  applyFindings,
  type FixResult,
  type JobReview,
  openBatchSources,
  runAgent,
} from "@valwell/agent";
import { add, type Finding, fromCents, type Invoice, type Money } from "@valwell/domain";
import { type CustomerPortal, openBillingStore, openPortal } from "@valwell/mock-systems";
import { loadFaultLabels, type ScoreResult, scoreFindings } from "./score.js";

export interface RunOutcome {
  name: string;
  /** Invoices sent to the portal. Only READY drafts are sent in agent runs. */
  submitted: number;
  approved: number;
  /** Approved / total invoices in the batch. */
  firstPassAcceptance: number;
  /** Invoices with every line held pending a change order. */
  fullyHeld: number;
  /** Invoices not sent because a finding awaits review or the input needs review. */
  notReady: number;
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
  prepare: (invoice: Invoice) => Pick<FixResult, "status" | "invoice">,
): RunOutcome {
  const reasons: Record<string, number> = {};
  let submitted = 0;
  let approved = 0;
  let fullyHeld = 0;
  let notReady = 0;
  for (const original of invoices) {
    const draft = prepare(original);
    if (draft.status === "ALL_LINES_HELD") fullyHeld++;
    if (draft.status !== "READY" || !draft.invoice) {
      if (draft.status !== "ALL_LINES_HELD") notReady++;
      continue;
    }
    submitted++;
    const decision = portal.submit(draft.invoice);
    if (decision.status === "APPROVED") approved++;
    else reasons[decision.reasonCode] = (reasons[decision.reasonCode] ?? 0) + 1;
  }
  const firstPassAcceptance = invoices.length === 0 ? 0 : approved / invoices.length;
  return {
    name,
    submitted,
    approved,
    firstPassAcceptance,
    fullyHeld,
    notReady,
    rejectionReasons: reasons,
  };
}

/**
 * Run 0 submits invoices straight to the portal. Run 1 applies only what the
 * agent does unattended (AUTO_FIX corrections and BLOCK holds); invoices with
 * an OPEN review finding are not sent. Run 2 marks every OPEN finding
 * ACCEPTED, i.e. it assumes a reviewer accepts every proposed action. That is
 * an assumption about the reviewer, not customer approval of held scope.
 */
export function runExperiment(
  invoices: readonly Invoice[],
  findings: readonly Finding[],
  reviews: readonly JobReview[],
  portal: CustomerPortal,
): ExperimentResult {
  const reviewOf = (invoice: Invoice) =>
    reviews.find((r) => r.invoiceId === invoice.id) ?? { status: "INCOMPLETE" as const };
  const accepted = acceptAll(findings);
  const runs = [
    submitAll("Run 0: baseline (no agent)", invoices, portal, (i) => ({
      status: "READY",
      invoice: i,
    })),
    submitAll("Run 1: agent, unattended (auto-fix + block)", invoices, portal, (i) =>
      applyFindings(i, findings, reviewOf(i)),
    ),
    submitAll("Run 2: agent, reviewer accepts all", invoices, portal, (i) =>
      applyFindings(i, accepted, reviewOf(i)),
    ),
  ];

  const drafts = invoices.map((i) => applyFindings(i, accepted, reviewOf(i)));
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
    experiment: runExperiment(billing.invoices(), run.findings, run.reviews, portal),
  };
}
