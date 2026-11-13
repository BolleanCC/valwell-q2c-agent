# valwell-q2c-agent

A prototype **quote-to-invoice reconciliation workflow** for a valve remanufacturing shop. It uses simulated
business systems only.

## The problem

Quoting, shop operations and billing live in separate systems. Invoices are re-keyed by hand, so they drift from
what was agreed. Prices don't match the contract price book, parts are marked up past the contract cap, and work
found after teardown is billed without the customer's approval. The customer's invoice portal rejects these
invoices, and payment is delayed.

Before an invoice is sent, an LLM works the case. It calls business tools to check the records, reconcile the
invoice, prepare a permitted draft, validate it with the simulated portal, and finish with an evidence-backed
disposition. The tools are deterministic code. They own every check, every amount and every permission, and the
application verifies the model's final disposition against what the tools actually recorded.

## The deterministic core (what the tools run)

```
read a case → validate records → align lines → detect issues → propose actions
            → draft (permitted actions only) → simulated portal
```

1. **Validate records** (`packages/agent/src/review.ts`). The job, quote, work order, invoice and contract rules
   must exist and refer to each other by stable ids (job, customer, PO). A difference in how a customer name is
   written doesn't matter. Dates are compared by their meaning:
   - the invoice must carry the job's service date, because the service date selects the effective price;
   - work cannot happen before the valve is received;
   - the invoice cannot predate the work.

   Otherwise quote, change-order and invoice dates are expected to differ. If any of these checks fails, the job
   is **INCOMPLETE** and no rules run.
2. **Align lines** (`nodes/align.ts`). Each invoice line is matched to the work-order line it bills. An explicit
   `sourceRef` wins. The item code is used only when exactly one work-order line has it. Invalid references,
   several candidates, mismatched line kinds and double billing are left unresolved. There is no fuzzy matching.
3. **Check line evidence** (`nodes/check-lines.ts`). Each line is checked for:
   - arithmetic: qty × unit price must equal the amount;
   - exactly one effective price (none and overlapping prices are separate problems);
   - part costs disclosed on the invoice that equal the work-order cost;
   - quantities: billed must equal recorded, and recorded must not exceed approved.

   Any problem makes the job **NEEDS_REVIEW**.
4. **Detect** (`detectors/`). Detectors judge only resolved lines:
   - **A1**: the price differs from the price book on the service date.
   - **A3**: a part is priced above cost × (1 + cap), checked only when the cost evidence is verified.
   - **B1**: work is not covered by the effective quote revision or an approved change order.
5. **Route** (`nodes/route.ts`). Each finding is routed by an explicit business reason, not by a score:

   | Condition | Route |
   | --- | --- |
   | Billed at a superseded price-book version | `AUTO_FIX` |
   | Price matches no version (cause unconfirmed) | `REVIEW` |
   | Part over cap, invoice and work-order costs agree | `AUTO_FIX` |
   | Work outside approved scope | `BLOCK` (hold the line) |
6. **Draft** (`fix.ts`). Only these findings are applied:
   - `AUTO_FIX` corrections;
   - `BLOCK` holds;
   - findings a human has marked `ACCEPTED`.

   An `OPEN` `REVIEW` finding is never applied, and a `REJECTED` finding is never applied. A held line keeps its
   original amount, and holding takes precedence over repricing the same line. Totals reconcile:
   **original − held + corrections = draft**. Applying the findings again changes nothing. A job that isn't
   `COMPLETE` gets no draft.
7. **Simulated portal** (`packages/mock-systems/src/portal.ts`). The portal is the customer's side. It rejects the
   whole invoice on any contract or scope violation.

Approved scope is the **effective quote revision** (the highest revision of each quote) plus approved change
orders. Earlier revisions authorise nothing. The agent and the portal share this rule (`latestRevisions` in
`packages/domain`).

## LLM orchestration of every case

```
case task (ids only) → model calls tools → tools return checks, findings, evidence
  → model picks a permitted action → application checks it → code prepares the draft / records the hold
  → simulated portal (READY drafts only) → model submits a disposition → application verifies it
```

Code: `packages/agent/src/workflow/` and `packages/agent/src/llm/`.

**Tools** (`workflow/tools.ts`). Every call is checked with zod, every id must belong to the case's job, and
unknown tools are refused.

| Tool | Kind | What application code enforces |
| --- | --- | --- |
| `validate_records` | read | Record and reference checks (`checkRecordLinks`) |
| `reconcile_invoice` | read | Refused until records are consistent; runs matching, line checks, detectors and routing (`runPipeline`) |
| `get_job_records` | read | Invoice, work order (with notes), effective quote or change orders |
| `prepare_draft(apply_finding_ids)` | in-memory state | Ids only, no prices. Reconciliation must be COMPLETE. OPEN REVIEW and REJECTED findings can't be applied. Every BLOCK finding must be held. Rebuilt from the original invoice each time, so repeats never double-apply |
| `submit_to_portal` | simulated | Only a READY draft |
| `draft_change_order_request` | in-memory state | Only for a held line; `validateDraft` checks the text and evidence; amounts inserted by code |
| `submit_disposition` | finish | `verifyDisposition`: required checks ran, all findings listed, evidence came from tools, no amounts or customer-approval claims, outcome matches state |

**What the model decides:** which records and checks to request, which permitted findings to apply, whether to
submit, what to write in a change-order request, and which outcome to claim. **What code decides:** whether
each of those is allowed, every number, every state change, and whether the claimed outcome is true. There is no
tool for accepting a finding. Human acceptance is an application event (`acceptFinding`), which the demo
simulates between the two runs of case 2.

Example traces (offline script; arguments and summaries shortened):

- **Case 1, normal repair.** The model finds nothing to correct and requests the unchanged draft.

  ```
  validate_records → RECORDS_CONSISTENT
  reconcile_invoice → review COMPLETE; findings: none
  prepare_draft [] → draft READY; changes 0; held 0; total $2,200.00
  submit_to_portal → simulated portal APPROVED
  submit_disposition NO_CORRECTION_REQUIRED → verified
  ```
- **Case 2, price entry error.** The model can't apply its own REVIEW proposal. The case pauses for a human, then
  resumes with the same case state.

  ```
  run 1: validate_records → reconcile_invoice → findings: F-0001 A1 REVIEW OPEN
         get_job_records invoice → prepare_draft [] → draft AWAITING_REVIEW (not submittable)
         submit_disposition AWAITING_HUMAN_ACCEPTANCE → verified
  human event (application): Simulated human reviewer accepted F-0001
  run 2: reconcile_invoice → F-0001 ACCEPTED → prepare_draft [F-0001] → READY, $354.00 → $570.00
         submit_to_portal → APPROVED → submit_disposition CORRECTED_AND_VALIDATED → verified
  ```
  If the model tries `prepare_draft [F-0001]` before acceptance, or calls `submit_to_portal`, the call is refused
  (tested).
- **Case 3, markup over cap.** The model applies the AUTO_FIX by id. Code computes the $220.00 cap price from the
  verified cost.

  ```
  reconcile_invoice → findings: F-0001 A3 AUTO_FIX OPEN
  prepare_draft [F-0001] → READY, $500.00 → $440.00 → submit_to_portal → APPROVED
  submit_disposition CORRECTED_AND_VALIDATED → verified
  ```
- **Case 4, unapproved extra work.** The hold is mandatory. The model investigates the documented reason and
  drafts the request.

  ```
  reconcile_invoice → findings: F-0001 B1 BLOCK OPEN
  prepare_draft [F-0001] → READY; held INV-D4-L5 $440.00 → submit_to_portal → APPROVED (remaining lines)
  get_job_records work_order → evidence incl. WO-D4-TDI-2, WO-D4-N1; get_job_records change_orders → none
  draft_change_order_request INV-D4-L5 → DRAFTED (amount 1 × $440.00 inserted by code; line stays held)
  submit_disposition PARTIAL_SUBMISSION_WITH_HOLD → verified
  ```

**Bounds and failures** (`llm/loop.ts`, `runToolLoop`):
- at most 10 model turns and 16 tool calls;
- a 60 s timeout per request;
- 4,000 output tokens;
- no retries.

A refused tool call goes back to the model as an error, and it may correct itself within the bounds. A run ends
either with a verified disposition or incomplete: `INVALID_OUTPUT`, `LIMIT_REACHED` or `PROVIDER_FAILURE`. An
incomplete run produces no disposition, isn't resumed, and is never replaced by offline output. Whatever the tools
already recorded, such as a held line, stays as it is.

**Limits of the checks.** Validation checks references, state and simple keywords. It can't prove that a
model's prose is true, which is why a human reviews change-order requests and the next human action is always
stated.

## Run the demo

Requires Node 24 and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm demo                 # all four cases orchestrated OFFLINE (scripted, simulated); writes data/runs/demo/demo.md
pnpm demo -- --llm live   # all four cases orchestrated by a real model via the Anthropic API (paid)
```

- **Offline mode** (the default, used by tests and CI): fixed scripted turns per case
  (`packages/eval/src/offline-scripts.ts`) play the model. They go through the same loop, tools, permission checks
  and disposition verification, so a script that broke a rule would fail. The demo labels every offline run as
  *simulated LLM behaviour from a fixed script, not a model run*. It shows the mechanics, not model reasoning.
- **Live mode**: real Messages API tool calls through the official `@anthropic-ai/sdk`, for all four cases. The
  model gets the same task prompt (ids only), the same tools and the same checks. No case-specific solution is
  chosen for it. Copy `.env.example` to `.env` (git-ignored) and set:

  | Variable | Required | Meaning |
  | --- | --- | --- |
  | `ANTHROPIC_API_KEY` | yes, for live mode | Read by the SDK; never printed |
  | `LLM_MODEL` | no | Model id, default `claude-opus-5-5` |

  Live mode has **not been run against the real API**. No paid calls were made during development. Request and
  response handling is tested with a fake client only, so a real model may take different paths. Its runs are
  still bound by the same permissions and verification.

| Case | Input | Outcome |
| --- | --- | --- |
| 1 Normal repair | Scope, work, quantities, prices and costs agree | `NO_CORRECTION_REQUIRED`: the unchanged $2,200.00 draft passes the portal |
| 2 Price entry error | Labour billed at $59.00 instead of $95.00 (6 h) | Run 1 `AWAITING_HUMAN_ACCEPTANCE` (nothing applied or submitted). Simulated human acceptance. Run 2 `CORRECTED_AND_VALIDATED`: $354.00 → $570.00, and the $2,200.00 draft passes |
| 3 Markup over cap | Seat billed at $250.00 on a verified $200.00 cost, 10 % cap | `CORRECTED_AND_VALIDATED`: AUTO_FIX to the cap price $220.00 (−$60.00), and the $2,200.00 draft passes |
| 4 Unapproved extra work | A replaced stem ($440.00) with no approved change order | `PARTIAL_SUBMISSION_WITH_HOLD`: $440.00 held, the remaining $2,200.00 passes, and a change-order request is drafted |

The cases are hand-written in `data/fixtures/demo/` in the same store layout the agent reads. They don't use the
random generator or any answer labels.

## Business assumptions and boundaries

- **The LLM orchestrates; it never authorises.** It can't accept a finding, choose a price, release a held line or
  send anything. Its claims count only when the case state confirms them.
- **Drafting, human acceptance, customer approval and the portal are four different things.** The LLM drafts a
  change-order request. A person accepts, edits and sends it. The customer approves the change order. Only an
  approved change order recorded in the quoting system makes the stem billable. The portal result is a
  simulation.
- **A finding is a proposal.** It is not proof that a correction has been approved.
- **Accepting a correction is not approving scope.** When a reviewer accepts a finding, the agent may change the
  draft. Approval of additional work can only come from the customer, through a change order. Accepting a B1
  finding only accepts holding the line.
- **Simulated portal approval is not submission, payment or business acceptance.**
- **Partial submission is allowed for the demo.** An unapproved line is held and the rest is submitted. The held
  amount stays visible and unresolved: it is not approved, not submitted and not paid.
- **Human review is required whenever input is missing, ambiguous or contradictory.** That covers missing
  records, conflicting ids, invalid references, several possible matches, a missing or overlapping price, missing
  or conflicting cost evidence, quantity differences and arithmetic errors. The agent never guesses a match or
  changes a price on uncertain evidence.
- **No contract-versus-quote price precedence is assumed.** Services and labour are priced from the price book on
  the service date. Parts are cost-plus under the contract cap.

## What exists and what does not

Implemented:
- LLM orchestration of the four demo cases (offline by default, live on request);
- the deterministic core and tools above;
- mock source systems and the portal simulator;
- a reconciliation report (`pnpm agent`).

The synthetic generator and label-based scoring (`pnpm generate`, `pnpm eval`) remain as a regression harness.
CI fails if recall on the committed `data/fixtures/seed-42` batch drops below 0.9. Synthetic precision and recall
show that the detectors still catch the faults the generator injects. They don't measure real-world invoice
accuracy.

Not implemented:
- real ERP, portal or payment integration;
- real customer approval;
- sending anything to a customer;
- a review UI;
- Docker/CD.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm demo` | Orchestrate the four fixed demo cases offline (scripted, simulated) |
| `pnpm demo -- --llm live` | Same, with a real model via the Anthropic API for every case |
| `pnpm check` | Lint, typecheck and test. Must pass before every commit |
| `pnpm agent -- --batch <dir>` | Run the agent on a store directory; writes `findings.json` and `report.md` to `data/runs/<name>/` |
| `pnpm generate -- --seed 42 --jobs 50` | Generate a synthetic batch with labelled faults |
| `pnpm eval -- --batch <dir> [--min-recall 0.9]` | Score findings against the labels and run the portal experiment |

Core files, in reading order:
1. `packages/eval/src/case-demo.ts`: one case, two runs when a human must accept.
2. `packages/agent/src/workflow/run.ts`: the case task and prompt.
3. `llm/loop.ts`: `runToolLoop`, bounds and failures.
4. `workflow/tools.ts`: the seven tools and their permission checks.
5. `workflow/state.ts`: case state and the `acceptFinding` human event.
6. `workflow/disposition.ts` and `workflow/change-order.ts`: verification of what the model submits.
7. The deterministic core, `pipeline.ts`, which the reconciliation tool runs:
   - `review.ts`
   - `nodes/align.ts`
   - `nodes/check-lines.ts`
   - `detectors/`
   - `nodes/route.ts`
   - `fix.ts`
8. `llm/anthropic.ts` and `packages/eval/src/offline-scripts.ts`: live and offline providers.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for how to work in this repo.
