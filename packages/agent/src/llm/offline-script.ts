import type { LlmProvider, ModelTurn } from "./loop.js";
import { callTools, scriptedProvider } from "./scripted.js";
import type { DraftingScope } from "./tools.js";

/**
 * The offline demo "model": a fixed script that calls the same read-only
 * tools a live model would, then submits a draft written from a template. It
 * is SIMULATED LLM behaviour for a reliable demo, not a model run. The final
 * draft cites only records the earlier tool calls return, so it still has to
 * pass the same validation as live output.
 */
export function offlineDraftingProvider(scope: DraftingScope): LlmProvider {
  const { ctx, finding } = scope;
  const job = ctx.job.id;
  const woLine = ctx.workOrder.lines.find((l) => l.id === finding.workOrderLineId);
  const tdiIndex = ctx.workOrder.tdiFindings.findIndex((t) =>
    t.recommendedItemCodes.some((c) => c === woLine?.itemCode),
  );
  const tdi = ctx.workOrder.tdiFindings[tdiIndex];
  const tdiId = tdi ? `${ctx.workOrder.id}-TDI-${tdiIndex + 1}` : null;
  const note = ctx.workOrder.technicianNotes?.find((n) => n.workOrderLineId === woLine?.id);
  const item = woLine?.description.toLowerCase() ?? "part";

  const reasonIds = [tdiId, note?.id].filter((id): id is string => id !== null && id !== undefined);
  const reason =
    tdi && reasonIds.length > 0
      ? `The ${tdi.component.toLowerCase()} was recorded as "${tdi.condition}" at teardown${note ? `, and technician note ${note.id} explains why it was replaced` : ""}.`
      : null;
  const submit: ModelTurn = {
    stopReason: "tool_use",
    text: "",
    toolCalls: [
      {
        id: "offline-submit",
        name: "submit_change_order_draft",
        input: {
          workSummary: `The ${item} (${woLine?.itemCode}) was replaced during the repair (work-order line ${woLine?.id}). It is not in the effective quote, and no change order covers it.`,
          businessReason: reason,
          evidenceIds: [finding.id, ...(woLine ? [woLine.id] : []), ...reasonIds],
          missingInformation: reason
            ? []
            : ["Why the extra work was needed (no technician note or teardown finding)"],
          customerRequestText: `During the repair of valve ${ctx.job.valveSerial} (PO ${ctx.job.poNumber}), our technician found that the ${item} needed replacement and replaced it. This work was not in the quote. Please review the attached change-order request and tell us whether you approve it.`,
        },
      },
    ],
  };
  return scriptedProvider([
    callTools(
      ["get_finding_details", { finding_id: finding.id }],
      ["get_work_order", { job_id: job }],
    ),
    callTools(["get_effective_quote", { job_id: job }], ["get_change_orders", { job_id: job }]),
    submit,
  ]).provider;
}
