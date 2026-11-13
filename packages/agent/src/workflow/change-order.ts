import {
  type AuthoritativeAmounts,
  amountsFromHeldLine,
  type ChangeOrderDraftContent,
  renderChangeOrderRequest,
  validateDraft,
} from "../llm/draft.js";
import type { ToolExecution } from "../llm/loop.js";
import type { ToolSpec } from "../llm/tools.js";
import type { CaseState } from "./state.js";

/** JSON Schema of the model-authored request text (mirrors ChangeOrderDraftContent; no amounts). */
export const CHANGE_ORDER_DRAFT_SCHEMA: ToolSpec["input_schema"] = {
  type: "object",
  properties: {
    workSummary: { type: "string" },
    businessReason: { anyOf: [{ type: "string" }, { type: "null" }] },
    evidenceIds: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    customerRequestText: { type: "string" },
  },
  required: [
    "workSummary",
    "businessReason",
    "evidenceIds",
    "missingInformation",
    "customerRequestText",
  ],
  additionalProperties: false,
};

/** A validated change-order request draft for one held line. Never sent by the system. */
export interface ChangeOrderRequestRecord {
  invoiceLineId: string;
  status: "DRAFTED" | "INSUFFICIENT_EVIDENCE";
  content: ChangeOrderDraftContent;
  /** From the held invoice line, by code; the model supplies no amounts. */
  amounts: AuthoritativeAmounts;
  /** Rendered for the human reviewer, amounts inserted. */
  request: string[];
}

/**
 * Record the model's change-order request draft for a line held in the
 * current draft. The text is model-authored; validateDraft checks it against
 * the evidence the tools returned, and the amounts come from the held line.
 * Drafting a request releases nothing: the line stays held.
 */
export function recordChangeOrderRequest(
  state: CaseState,
  invoiceLineId: string,
  draft: unknown,
): ToolExecution {
  const held = state.draft?.held.find((l) => l.id === invoiceLineId);
  if (!held) return { ok: false, error: `${invoiceLineId} is not held in the current draft` };
  const finding = state.findings.find(
    (f) => f.frictionCode === "B1" && f.invoiceLineId === invoiceLineId,
  );
  if (!finding?.workOrderLineId) {
    return {
      ok: false,
      error: `${invoiceLineId} has no scope finding to request a change order for`,
    };
  }
  const v = validateDraft(draft, state.evidence, finding.workOrderLineId);
  if (v.status === "INVALID_OUTPUT") {
    return { ok: false, error: `change-order request rejected: ${v.problems.join("; ")}` };
  }
  const amounts = amountsFromHeldLine(held, finding.workOrderLineId);
  const record: ChangeOrderRequestRecord = {
    invoiceLineId,
    status: v.status,
    content: v.content,
    amounts,
    request: renderChangeOrderRequest(v.content, amounts),
  };
  state.changeOrderRequests = [
    ...state.changeOrderRequests.filter((r) => r.invoiceLineId !== invoiceLineId),
    record,
  ];
  return {
    ok: true,
    content: { status: v.status, request: record.request, lineStillHeld: true },
    summary: `change-order request ${v.status} for ${invoiceLineId} (line stays held)`,
  };
}
