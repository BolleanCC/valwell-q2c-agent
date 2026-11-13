# valwell-q2c-agent

A prototype **quote-to-invoice reconciliation workflow** for a valve remanufacturing shop. It uses simulated
business systems only.

## The problem

Quoting, shop operations and billing live in separate systems. Invoices are re-keyed by hand, so they drift from
what was agreed. Prices don't match the contract price book, parts are marked up past the contract cap, and work
found after teardown is billed without the customer's approval. The customer's invoice portal rejects these
invoices, and payment is delayed.

Before an invoice is sent, this prototype checks it against the other records and proposes corrections. Every
correction cites its source evidence and needs explicit approval rules before it is applied. All reconciliation
and every amount is deterministic code. An LLM is used for one narrow job: when extra work has been held off an
invoice, it investigates the records through read-only tools and drafts a change-order request for a human.

## The workflow (deterministic, no LLM)

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

## LLM drafting for held extra work (case 4 only)

Cases 1–3 need no LLM. The rules fully decide them, and code computes the corrected amounts. Case 4 is different.
The rules can hold the extra line, but someone still has to explain the extra work to the customer and ask for a
change order. That part is reading and writing, so the LLM drafts it, and a human decides.

How it works (`packages/agent/src/llm/`):

1. The deterministic pipeline finishes first. The B1 finding holds `INV-D4-L5` (stem, $440.00).
2. `loop.ts`: `draftChangeOrderRequest` gives the model the finding and a narrow task. The model receives tool
   definitions, not the records.
3. The model chooses tools and the loop runs them (`tools.ts`):
   - `get_finding_details`
   - `get_work_order`, which returns lines, teardown findings and technician notes
   - `get_effective_quote`
   - `get_change_orders`

   The tools are read-only and scoped to the current job. Their arguments are checked with zod, and unknown
   tools and other jobs' ids are refused. They return no prices, and every record carries a stable evidence
   id. Text from records is marked as data, never instructions.
4. The model returns its result through `submit_change_order_draft`. That result contains:
   - a work summary;
   - the documented reason, or `null`;
   - evidence ids;
   - missing information;
   - customer text.

   It contains **no financial fields**.
5. `draft.ts`: `validateDraft` applies these checks:
   - the output matches the schema exactly;
   - every evidence id came from a successful tool call in this run (so it belongs to this job), and the held
     work-order line is cited;
   - the text claims no approval, submission, payment or release, and contains no money;
   - a stated reason cites a technician note or a teardown finding;
   - if no reason is documented, the draft must list what is missing. That makes it `INSUFFICIENT_EVIDENCE`.

   These are modest reference and keyword checks. They do not prove the draft is factually correct, which is
   why a human reviews it.
6. The amount (1 × $440.00) is taken from the held invoice line and inserted into the rendered request by code.

Limits (`LIMITS` in `loop.ts`):
- 6 model turns;
- 10 tool calls;
- a 60 s timeout per request;
- 4,000 output tokens;
- no automatic retries.

Every run ends in one of these states: `DRAFTED`, `INSUFFICIENT_EVIDENCE`, `INVALID_OUTPUT`, `LIMIT_REACHED` or
`PROVIDER_FAILURE`. The demo prints the tool trace (tool, arguments, result summary or error) whichever way it
ends. If drafting fails, the deterministic result stands, the line stays held, and the demo says drafting did not
complete. Offline output is never substituted for a failed live run.

The LLM never calculates or chooses amounts. It never approves anything, changes a finding's status, modifies
records or invoices, releases the held line, submits an invoice or sends a message.

## Run the demo

Requires Node 24 and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm demo                 # four fixed cases; case 4 drafting is OFFLINE (simulated); writes data/runs/demo/demo.md
pnpm demo -- --llm live   # same, but case 4 makes real Anthropic API calls (paid)
```

- **Offline mode** (the default, used by tests and CI): a fixed script plays the model. It calls the same tools
  through the same loop and submits a templated draft that must pass the same validation. The demo labels it
  *simulated LLM behaviour, not a model run*.
- **Live mode**: real Messages API tool calls through the official `@anthropic-ai/sdk`. Copy `.env.example` to
  `.env` (git-ignored) and set:

  | Variable | Required | Meaning |
  | --- | --- | --- |
  | `ANTHROPIC_API_KEY` | yes, for live mode | Read by the SDK; never printed |
  | `LLM_MODEL` | no | Model id, default `claude-opus-5-5` |

  Live mode has **not been run against the real API** during development. Its request and response handling is
  tested with a fake client only.

| Case | Input | Outcome |
| --- | --- | --- |
| 1 Normal repair | Scope, work, quantities, prices and costs agree | Review complete, no findings, $2,200.00 approved by the portal |
| 2 Price entry error | Labour billed at $59.00 instead of $95.00 (6 h) | `REVIEW`. While the finding is `OPEN`, nothing is applied and nothing is submitted. After a simulated acceptance the line goes from $354.00 to $570.00 and the $2,200.00 draft passes |
| 3 Markup over cap | Seat billed at $250.00 on a verified $200.00 cost, 10 % cap | `AUTO_FIX` to $220.00 (−$60.00). The $2,200.00 draft passes |
| 4 Unapproved extra work | A replaced stem ($440.00) with no approved change order | `BLOCK`. The line is held at $440.00 and the remaining $2,200.00 passes |

The cases are hand-written in `data/fixtures/demo/` in the same store layout the agent reads. They don't use the
random generator or any answer labels.

## Business assumptions and boundaries

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

Implemented: the deterministic workflow above, mock source systems, the portal simulator, the demo, and a
reconciliation report (`pnpm agent`).

The synthetic generator and label-based scoring (`pnpm generate`, `pnpm eval`) remain as a regression harness.
CI fails if recall on the committed `data/fixtures/seed-42` batch drops below 0.9. Synthetic precision and recall
show that the detectors still catch the faults the generator injects. They don't measure real-world invoice
accuracy.

Implemented with an LLM: change-order request drafting for held extra work (offline by default, live on request).

Not implemented:
- real ERP, portal or payment integration;
- real customer approval;
- sending anything to a customer;
- a review UI;
- Docker/CD.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm demo` | Run the four fixed demo cases; case 4 drafting offline (simulated) |
| `pnpm demo -- --llm live` | Same, with real Anthropic API calls for case 4 |
| `pnpm check` | Lint, typecheck and test. Must pass before every commit |
| `pnpm agent -- --batch <dir>` | Run the agent on a store directory; writes `findings.json` and `report.md` to `data/runs/<name>/` |
| `pnpm generate -- --seed 42 --jobs 50` | Generate a synthetic batch with labelled faults |
| `pnpm eval -- --batch <dir> [--min-recall 0.9]` | Score findings against the labels and run the portal experiment |

Core files, in reading order:
1. `packages/agent/src/pipeline.ts`
2. `review.ts`
3. `nodes/align.ts`
4. `nodes/check-lines.ts`
5. `detectors/*.ts`
6. `nodes/route.ts`
7. `fix.ts`
8. `llm/tools.ts`
9. `llm/draft.ts`
10. `llm/loop.ts`
11. `llm/anthropic.ts` and `llm/offline-script.ts`
12. `packages/eval/src/demo.ts`

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for how to work in this repo.
