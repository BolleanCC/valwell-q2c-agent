import type { CaseRun } from "@valwell/agent";
import { format, type Money } from "@valwell/domain";
import type { PortalDecision } from "@valwell/mock-systems";
import type { CaseDemoResult } from "./case-demo.js";

/** The four fixed demo cases, in presentation order. */
export const DEMO_CASES = [
  { dir: "1-normal-repair", title: "Normal repair" },
  { dir: "2-price-entry-error", title: "Price entry error" },
  { dir: "3-markup-over-cap", title: "Parts markup exceeds the contract cap" },
  { dir: "4-unapproved-extra-work", title: "Unapproved additional work" },
] as const;

export const DEMO_HEADER = [
  "# Quote-to-invoice reconciliation demo: LLM orchestration",
  "",
  "In every case the model calls business tools to check, draft and finish the case. The tools own every",
  "check, amount and permission; the model's final disposition is verified against what the tools recorded.",
  "Simulated systems and synthetic data only: nothing is sent to a real customer or portal.",
  "",
].join("\n");

const signed = (m: Money) => (m > 0 ? `+${format(m)}` : format(m));

function portalText(d: PortalDecision | null): string {
  if (!d) return "not submitted";
  if (d.status === "APPROVED") return "APPROVED (simulated)";
  return `REJECTED (simulated): ${d.reasons.map((r) => `${r.code} — ${r.message}`).join("; ")}`;
}

function runLines(n: number, run: CaseRun): string[] {
  const label =
    run.mode === "offline"
      ? "OFFLINE — simulated LLM behaviour from a fixed script, not a model run"
      : `LIVE — ${run.model} via the Anthropic API`;
  const out = [
    `- Run ${n} (${label})`,
    ...run.trace.map(
      (t, i) =>
        `  ${i + 1}. [turn ${t.turn}] ${t.tool ?? "model text"} ${t.args} → ${t.ok ? "ok" : "REFUSED"}: ${t.summary}`,
    ),
  ];
  const d = run.disposition;
  if (!d) {
    return [
      ...out,
      `  - **LLM orchestration did not complete** (${run.status}): ${run.problems.join("; ")}. No disposition.`,
    ];
  }
  const f = d.facts;
  const findings =
    f.findings.map((x) => `${x.id} ${x.frictionCode} ${x.route} ${x.status}`).join(", ") || "none";
  return [
    ...out,
    `  - Disposition (verified against the case state): **${d.outcome}**`,
    `    - Model summary: ${d.summary}`,
    `    - Next human action: ${d.next_human_action}`,
    `    - Verified facts (from tools): review ${f.reviewStatus}; findings ${findings}; draft ${f.draftStatus ?? "none"}; portal ${f.portal}`,
  ];
}

/** Render one case for the terminal and demo.md. Pure. */
export function renderCaseDemo(index: number, title: string, r: CaseDemoResult): string {
  const { invoice } = r.original;
  const out = [
    `## Case ${index} · ${title}`,
    "",
    `- Input: ${r.state.ctx.job.id}, invoice ${invoice.id} (${invoice.lines.length} lines)`,
    `- Without the agent: original invoice → simulated portal ${portalText(r.original.portal)}`,
  ];
  r.runs.forEach((run, i) => {
    if (i > 0) {
      out.push(
        `- Human event (simulated by the application, outside the model): ${r.state.humanEvents.join("; ")}`,
      );
    }
    out.push(...runLines(i + 1, run));
  });

  const draft = r.state.draft;
  const failed = !r.runs.at(-1)?.disposition;
  out.push(
    failed
      ? "- Case state recorded by the tools before orchestration stopped:"
      : "- Final case state (application):",
  );
  if (!draft) out.push("  - No draft was prepared.");
  else {
    const t = draft.totals;
    out.push(`  - Draft: **${draft.status}**`);
    for (const c of draft.changes) {
      out.push(
        `  - Draft action: ${c.invoiceLineId} ${format(c.before.amount)} → ${format(c.after.amount)}`,
      );
    }
    for (const h of draft.held) {
      out.push(
        `  - Held (not submitted, not approved, not paid): ${h.id} ${h.itemCode} ${format(h.amount)}`,
      );
    }
    out.push(
      `  - Totals: original ${format(t.original)} − held ${format(t.held)} + corrections ${signed(t.corrections)} = draft ${format(t.draft)}`,
      `  - Simulated portal: ${portalText(r.state.portalDecision)}`,
    );
  }
  for (const req of r.state.changeOrderRequests) out.push(...req.request.map((l) => `    > ${l}`));
  return `${out.join("\n")}\n`;
}
