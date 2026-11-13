# valwell-q2c-agent

A prototype **quote-to-invoice reconciliation workflow** for a valve remanufacturing shop. It uses simulated
business systems only.

## The problem

Quoting, shop operations and billing live in separate systems. Invoices are re-keyed by hand, so they drift from
what was agreed. Prices don't match the contract price book, parts are marked up past the contract cap, and work
found after teardown is billed without the customer's approval. The customer's invoice portal rejects these
invoices, and payment is delayed.

Before an invoice is sent, this prototype checks it against the other records and proposes corrections. Every
correction cites its source evidence and needs explicit approval rules before it is applied.

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

## Run the demo

Requires Node 24 and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm demo        # four fixed cases, offline; also writes data/runs/demo/demo.md
```

| Case | Input | Outcome |
| --- | --- | --- |
| 1 Normal repair | Scope, work, quantities, prices and costs agree | Review complete, no findings, $2,200.00 approved by the portal |
| 2 Price entry error | Labour billed at $59.00 instead of $95.00 (6 h) | `REVIEW`. While the finding is `OPEN`, nothing is applied and nothing is submitted. After a simulated acceptance the line goes from $354.00 to $570.00 and the $2,200.00 draft passes |
| 3 Markup over cap | Seat billed at $250.00 on a verified $200.00 cost, 10 % cap | `AUTO_FIX` to $220.00 (−$60.00). The $2,200.00 draft passes |
| 4 Unapproved extra work | A replaced stem ($440.00) with no approved change order | `BLOCK`. The line is held at $440.00 and the remaining $2,200.00 passes |

The cases are hand-written in `data/fixtures/demo/` in the same store layout the agent reads. They don't use the
random generator or any answer labels.

## Business assumptions and boundaries

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

Not implemented:
- real ERP, portal or payment integration;
- real customer approval;
- any LLM capability;
- a review UI;
- Docker/CD.

The UI, Docker/CD and LLM drafting are deferred.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm demo` | Run the four fixed demo cases offline |
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
8. `packages/eval/src/demo.ts`

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for how to work in this repo.
