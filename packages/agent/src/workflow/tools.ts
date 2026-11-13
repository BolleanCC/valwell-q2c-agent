import { format, type Money } from "@valwell/domain";
import { z } from "zod";
import { applyFindings, isActionable } from "../fix.js";
import type { EvidenceSource } from "../llm/draft.js";
import { SUBMIT_TOOL, type ToolCall, type ToolExecution } from "../llm/loop.js";
import { getChangeOrders, getEffectiveQuote, getWorkOrder, type ToolSpec } from "../llm/tools.js";
import { runPipeline } from "../pipeline.js";
import { checkRecordLinks } from "../review.js";
import { recordChangeOrderRequest } from "./change-order.js";
import type { CaseState } from "./state.js";

const signed = (m: Money) => (m > 0 ? `+${format(m)}` : format(m));
const fail = (error: string): ToolExecution => ({ ok: false, error });
const jobProps = { job_id: { type: "string", description: "The job of this case" } };

function register(state: CaseState, refs: { id: string; source: EvidenceSource }[]): void {
  for (const r of refs) state.evidence.set(r.id, r.source);
}

// ---- validate_records ----

function validateRecords(state: CaseState): ToolExecution {
  const { job, invoice, workOrder, quotes, rules } = state.ctx;
  const issues = checkRecordLinks(state.ctx);
  state.recordCheck = { passed: issues.length === 0, issues };
  register(state, [
    { id: job.id, source: "JOB" },
    { id: invoice.id, source: "INVOICE" },
    { id: workOrder.id, source: "WORK_ORDER" },
    { id: rules.id, source: "RULE" },
    ...quotes.map((q) => ({ id: q.id, source: "QUOTE" as const })),
  ]);
  const status = issues.length === 0 ? "RECORDS_CONSISTENT" : "INCOMPLETE";
  return {
    ok: true,
    content: { status, issues, checked: [job.id, invoice.id, workOrder.id, rules.id] },
    summary: `${status}${issues.length ? `: ${issues.map((i) => i.code).join(", ")}` : ""}`,
  };
}

// ---- reconcile_invoice ----

function reconcileInvoice(state: CaseState): ToolExecution {
  if (!state.recordCheck) return fail("call validate_records first");
  if (!state.recordCheck.passed) {
    return fail(
      "records are INCOMPLETE, so reconciliation cannot run; the case needs human review",
    );
  }
  // Run once. Later calls return the same findings with their current status
  // (a human may have accepted one since).
  if (!state.review) {
    const { reviews, findings } = runPipeline([state.ctx]);
    state.review = reviews[0] ?? null;
    state.findings = findings;
  }
  const review = state.review;
  if (!review) return fail("reconciliation produced no result");
  register(state, [
    ...state.findings.map((f) => ({ id: f.id, source: "FINDING" as const })),
    ...state.findings.flatMap((f) => f.evidence.map((e) => ({ id: e.id, source: e.kind }))),
  ]);
  const findings = state.findings.map((f) => ({
    id: f.id,
    frictionCode: f.frictionCode,
    invoiceLineId: f.invoiceLineId,
    workOrderLineId: f.workOrderLineId,
    message: f.message,
    route: f.route,
    routeReason: f.routeReason,
    status: f.status,
    proposedAction: f.suggestion.summary,
    proposedAmountChange: signed(f.suggestion.amountDelta),
    evidence: f.evidence.map((e) => e.id),
  }));
  const list = findings.map((f) => `${f.id} ${f.frictionCode} ${f.route} ${f.status}`).join(", ");
  return {
    ok: true,
    content: { reviewStatus: review.status, issues: review.issues, findings },
    summary: `review ${review.status}; findings: ${list || "none"}`,
  };
}

// ---- get_job_records ----

const RECORDS = ["invoice", "work_order", "effective_quote", "change_orders"] as const;

function getJobRecords(state: CaseState, record: (typeof RECORDS)[number]): ToolExecution {
  if (record === "invoice") {
    const inv = state.ctx.invoice;
    register(
      state,
      inv.lines.map((l) => ({ id: l.id, source: "INVOICE_LINE" as const })),
    );
    const lines = inv.lines.map((l) => ({
      id: l.id,
      itemCode: l.itemCode,
      kind: l.kind,
      qty: l.qty,
      unitPrice: format(l.unitPrice),
      amount: format(l.amount),
    }));
    return {
      ok: true,
      content: { invoiceId: inv.id, serviceDate: inv.serviceDate, lines },
      summary: `evidence: ${lines.map((l) => l.id).join(", ")}`,
    };
  }
  const outcome =
    record === "work_order"
      ? getWorkOrder(state.ctx)
      : record === "effective_quote"
        ? getEffectiveQuote(state.ctx)
        : getChangeOrders(state.ctx);
  if (!outcome.ok) return outcome;
  register(state, outcome.evidence);
  return {
    ok: true,
    content: outcome.data,
    summary: `evidence: ${outcome.evidence.map((e) => e.id).join(", ") || "none"}`,
  };
}

// ---- prepare_draft (state-changing, in memory only) ----

/**
 * Prepare an in-memory draft from finding ids. The model chooses which
 * findings to apply; application code decides whether each is permitted and
 * computes every amount. No price or amount is ever accepted from the model.
 * The draft is always rebuilt from the original invoice, so repeating the
 * request never applies a change twice.
 */
function prepareDraft(state: CaseState, ids: string[]): ToolExecution {
  const review = state.review;
  if (!review) return fail("call reconcile_invoice first");
  if (review.status !== "COMPLETE") {
    return fail(
      `reconciliation is ${review.status}: missing or contradictory evidence needs human review, so no draft can be prepared`,
    );
  }
  const unknown = ids.filter((id) => !state.findings.some((f) => f.id === id));
  if (unknown.length > 0) return fail(`unknown finding ids: ${unknown.join(", ")}`);
  const selected = state.findings.filter((f) => ids.includes(f.id));
  for (const f of selected) {
    if (f.status === "REJECTED")
      return fail(`${f.id} was rejected by a human and cannot be applied`);
    if (!isActionable(f)) {
      return fail(
        `${f.id} is OPEN and routed to REVIEW: it needs human acceptance, which the model cannot give`,
      );
    }
  }
  const unheld = state.findings.filter(
    (f) => f.route === "BLOCK" && f.status !== "REJECTED" && !ids.includes(f.id),
  );
  if (unheld.length > 0) {
    return fail(
      `${unheld.map((f) => f.id).join(", ")} must be held: work outside approved scope cannot be submitted`,
    );
  }
  const pending = state.findings.filter((f) => f.status === "OPEN" && f.route === "REVIEW");
  const draft = applyFindings(state.ctx.invoice, [...selected, ...pending], review);
  state.draft = draft;
  state.portalDecision = null;
  const t = draft.totals;
  return {
    ok: true,
    content: {
      status: draft.status,
      appliedFindings: draft.applied.map((f) => f.id),
      changes: draft.changes.map((c) => ({
        invoiceLineId: c.invoiceLineId,
        before: format(c.before.amount),
        after: format(c.after.amount),
      })),
      held: draft.held.map((l) => ({
        invoiceLineId: l.id,
        itemCode: l.itemCode,
        amount: format(l.amount),
      })),
      totals: {
        original: format(t.original),
        held: format(t.held),
        corrections: signed(t.corrections),
        draft: format(t.draft),
      },
      awaitingHumanAcceptance: pending.map((f) => f.id),
    },
    summary: `draft ${draft.status}; changes ${draft.changes.length}; held ${draft.held.length}; total ${format(t.draft)}`,
  };
}

// ---- submit_to_portal (simulated; READY drafts only) ----

function submitToPortal(state: CaseState): ToolExecution {
  const draft = state.draft;
  if (!draft) return fail("no draft: call prepare_draft first");
  if (draft.status !== "READY" || !draft.invoice) {
    return fail(`draft is ${draft.status}; only a READY draft may be submitted`);
  }
  const decision = state.portal.submit(draft.invoice);
  state.portalDecision = decision;
  const reasons = decision.status === "REJECTED" ? decision.reasons : [];
  return {
    ok: true,
    content: { simulated: true, status: decision.status, reasons },
    summary: `simulated portal ${decision.status}${reasons.length ? `: ${reasons.map((r) => r.code).join(", ")}` : ""}`,
  };
}

// ---- Tool catalogue and dispatch ----

export const CASE_TOOL_SPECS: ToolSpec[] = [
  {
    name: "validate_records",
    description:
      "Check that the job, quote, work order, invoice and contract rules exist and belong together. Required first.",
    input_schema: {
      type: "object",
      properties: jobProps,
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "reconcile_invoice",
    description:
      "Run the deterministic reconciliation (line matching, price, quantity, cost and markup checks, scope). Returns the review status and findings with authoritative proposed amounts and routes.",
    input_schema: {
      type: "object",
      properties: jobProps,
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_job_records",
    description:
      "Read one kind of record for the job: invoice, work_order, effective_quote or change_orders.",
    input_schema: {
      type: "object",
      properties: { ...jobProps, record: { type: "string", enum: [...RECORDS] } },
      required: ["job_id", "record"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_draft",
    description:
      "Prepare the in-memory invoice draft by applying findings, referenced by id only. AUTO_FIX and BLOCK findings, or findings a human ACCEPTED, may be applied; every BLOCK finding must be held. Amounts are computed by the system.",
    input_schema: {
      type: "object",
      properties: { ...jobProps, apply_finding_ids: { type: "array", items: { type: "string" } } },
      required: ["job_id", "apply_finding_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_to_portal",
    description:
      "Submit the current draft to the simulated customer portal. Only a READY draft is accepted.",
    input_schema: {
      type: "object",
      properties: jobProps,
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "draft_change_order_request",
    description:
      "Record a change-order request draft for a held line, for human review. Write text only (no prices, amounts or approval claims) and cite evidence ids returned by tools; set businessReason to null and list missingInformation if no reason is documented.",
    input_schema: {
      type: "object",
      properties: {
        ...jobProps,
        invoice_line_id: { type: "string" },
        draft: SUBMIT_TOOL.input_schema,
      },
      required: ["job_id", "invoice_line_id", "draft"],
      additionalProperties: false,
    },
  },
];

const jobArg = z.object({ job_id: z.string() }).strict();
const changeOrderArg = z
  .object({ job_id: z.string(), invoice_line_id: z.string(), draft: z.unknown() })
  .strict();
const draftArg = z
  .object({ job_id: z.string(), apply_finding_ids: z.array(z.string()).max(20) })
  .strict();
const recordsArg = z.object({ job_id: z.string(), record: z.enum(RECORDS) }).strict();

/** Validate arguments and the job scope; never look up an id from another job. */
function parseArgs<T extends { job_id: string }>(
  state: CaseState,
  call: ToolCall,
  schema: z.ZodType<T>,
): { ok: true; args: T } | { ok: false; error: string } {
  const r = schema.safeParse(call.input);
  if (!r.success) {
    const why = r.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ");
    return { ok: false, error: `invalid arguments for ${call.name}: ${why}` };
  }
  if (r.data.job_id !== state.ctx.job.id) {
    return { ok: false, error: `job ${r.data.job_id} is outside this case (${state.ctx.job.id})` };
  }
  return { ok: true, args: r.data };
}

/**
 * Execute one model tool call against the case. Arguments are validated,
 * identifiers must belong to this case's job, and unknown tools are refused.
 */
export function executeCaseTool(state: CaseState, call: ToolCall): ToolExecution {
  switch (call.name) {
    case "validate_records": {
      const a = parseArgs(state, call, jobArg);
      return a.ok ? validateRecords(state) : a;
    }
    case "reconcile_invoice": {
      const a = parseArgs(state, call, jobArg);
      return a.ok ? reconcileInvoice(state) : a;
    }
    case "get_job_records": {
      const a = parseArgs(state, call, recordsArg);
      return a.ok ? getJobRecords(state, a.args.record) : a;
    }
    case "prepare_draft": {
      const a = parseArgs(state, call, draftArg);
      return a.ok ? prepareDraft(state, a.args.apply_finding_ids) : a;
    }
    case "submit_to_portal": {
      const a = parseArgs(state, call, jobArg);
      return a.ok ? submitToPortal(state) : a;
    }
    case "draft_change_order_request": {
      const a = parseArgs(state, call, changeOrderArg);
      return a.ok ? recordChangeOrderRequest(state, a.args.invoice_line_id, a.args.draft) : a;
    }
    default:
      return fail(`unknown tool ${call.name}`);
  }
}
