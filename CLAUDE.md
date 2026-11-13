# CLAUDE.md — valwell-q2c-agent

This file is the standing rulebook for this repository. Read it at the start of every session and follow it
over any conflicting habit or default.

## 1. What we are building

A demo of a **quote-to-invoice reconciliation agent** for an oilfield service company (modelled on Valwell
Technologies, Alberta: wellhead supply, valve/wellhead remanufacturing, field services, construction).

The real company's quoting system and billing system are disconnected, and things go wrong between them: prices
drift, scope changes after teardown, invoices get rejected. We do not have access to their systems, so this repo
contains:

1. **Mock source systems.** A quoting system, an operations system (shop work orders), a billing system, and a
   customer invoice-portal simulator. Each keeps its own store and never reads another's.
2. **A synthetic data generator.** It first builds a fully correct "ground truth" job, then **injects labelled
   faults** (frictions) and records each one in `fault_labels`. Every generated batch is therefore an evaluation set
   with answers.
3. **The agent.** It sits between the systems. Before an invoice is sent, it aligns quote ↔ work order ↔ invoice ↔
   price book line by line, validates against customer rules, classifies discrepancies, and proposes fixes or change
   orders for a human to approve.
4. **An evaluation harness.** It compares the agent's findings with `fault_labels`, and runs portal-sim
   with and without the agent.

The agent must never see `fault_labels`. Only the evaluation harness reads them.

## 2. Domain glossary

| Term | Meaning |
| --- | --- |
| Price book | Customer-specific unit prices, versioned with `effectiveFrom` / `effectiveTo`. The price that applies is the one effective on the service date. |
| MSA | Master Service Agreement: the framework contract that holds rate sheets and rules (for example a markup cap). |
| Quote / revision | A priced offer. Quotes are revised; every revision is immutable and identified by `quoteId` plus `revision`. |
| TDI | Teardown & Inspection. In remanufacturing, a valve is first disassembled and inspected (billed separately), then a repair quote is issued. Findings at TDI often expand scope. |
| Work order | The shop record of what was actually done: labour hours, parts used, hydro-test result. |
| Change order | A customer-approved amendment to scope or price. Work outside the quote is billable only when an approved change order covers it. |
| PO / AFE | The customer's purchase order and authorization-for-expenditure codes. Invoices must reference valid ones. |
| Markup cap | Contract limit on markup over cost for parts and third-party items (for example 10%). |
| Finding | A discrepancy detected by the agent, with friction code, evidence references, a suggested action and a confidence score. |
| Fault label | Ground truth written by the generator for each injected fault. Used only by evaluation. |

## 3. Scope of v1

- **Business line:** shop remanufacturing only (valve repair with a two-stage TDI → repair quote).
- **Frictions in scope:**
  - **A1. Stale price.** An invoice line uses a price-book version that is not effective on the service date, or a mistyped price.
  - **A3. Markup cap violation.** A part is billed at cost × (1 + markup) where the markup is above the customer's cap.
  - **B1. Post-teardown scope change without an approved change order.** The work order contains parts or labour that are in neither the quote nor any approved change order.
- **Out of scope for v1:** field tickets, handwritten-ticket OCR, construction LEMs, real ERP or portal integrations, authentication.

Other frictions (A2, B2, B3, C1–C4, D1–D4, E1, E2, F1) may be added later. Design interfaces so that adding a new
friction means adding one injector, one detector and their tests.

## 4. Fixed technical decisions

Do not change these without an ADR in `docs/adr/` and my explicit approval.

- **Language:** TypeScript everywhere, `strict: true`, ESM only.
- **Runtime:** Node.js 24 LTS. The version is pinned in `.node-version`.
- **Package manager:** pnpm with workspaces. `packageManager` is pinned in the root `package.json`.
- **Schemas and types:** zod. Derive TS types with `z.infer`, never hand-write a duplicate type.
- **Lint and format:** Biome (single tool). No ESLint or Prettier.
- **Tests:** Vitest.
- **Script runner:** `tsx`.
- **Git hooks:** lefthook (pre-commit: Biome on staged files; commit-msg: commitlint with the Conventional Commits config).
- **CI/CD:** GitHub Actions. CD publishes a Docker image to GHCR. That comes in a later milestone.
- **Web UI (later milestone):** Next.js (App Router) in `apps/web`.
- **LLM (later milestone):** behind a provider interface in `packages/agent/src/llm/`. The API key comes from an env
  var. CI and unit tests never call a real LLM; they use a fake provider.
- **Storage for v1:** JSON files under `data/`. `data/` is git-ignored except `data/fixtures/`. Each mock system
  accesses storage only through its own repository interface, so it can be swapped for Postgres later.

## 5. Repository layout (target)

```
.
├── .github/
│   ├── workflows/ci.yml          # lint, typecheck, test, build on PR and push to main
│   ├── workflows/cd.yml          # later: docker build and push to GHCR
│   ├── dependabot.yml
│   └── pull_request_template.md
├── apps/
│   └── web/                      # later: Next.js review UI
├── packages/
│   ├── domain/                   # zod schemas, Money, IDs, shared types. No I/O.
│   ├── generator/                # seeded ground-truth generator and fault injectors
│   ├── mock-systems/             # quote / ops / billing stores and portal-sim
│   ├── rules/                    # customer rule schema, loader and pure rule functions
│   ├── agent/                    # adapters, pipeline nodes, report
│   └── eval/                     # metrics and experiment runner
├── data/fixtures/                # small committed sample batches
├── docs/adr/                     # architecture decision records
├── CLAUDE.md
├── CONTRIBUTING.md
└── README.md
```

## 6. Engineering rules (non-negotiable)

1. **Money is integer cents.** Use the `Money` helpers in `packages/domain`. Never use floating-point arithmetic on
   money. Round only in one documented place.
2. **Determinism.** All randomness goes through a seeded PRNG passed in explicitly. The same seed must produce
   byte-identical output, and a test must assert this.
3. **The LLM never produces money.** Amounts, quantities and prices come from deterministic code and are inserted
   after generation. LLM output that contains money or claims approval, submission or payment is rejected
   (`validateDraft`, `verifyDisposition`). The LLM acts only through job-scoped tools in
   `packages/agent/src/workflow/tools.ts`, which take ids, never amounts. Human acceptance is never a tool.
4. **Every finding cites evidence.** Each finding references at least one source id: a quote line, work-order line,
   price-book item, change order or rule.
5. **Lineage.** Every invoice line the agent drafts carries `sourceRef` (quote line, work-order line, price-book
   version, change order).
6. **Adapters at the edges.** The agent talks to the mock systems only through interfaces in
   `packages/agent/src/adapters/`. Never import a mock system's internals into the agent.
7. **Pure core.** Rule functions and detectors are pure and unit-tested. I/O stays in thin outer layers.
8. **No network in tests.** No secrets in code. Keep `.env` local and commit `.env.example`.
9. **Respect package boundaries.** `domain` depends on nothing internal. `generator`, `mock-systems`, `rules`,
   `agent` and `eval` may depend on `domain`. `agent` must not depend on `generator` or `eval`.
10. **Unresolved means human review.** Missing, ambiguous or contradictory input (records, references, matches,
    prices, cost evidence, quantities, arithmetic) becomes a review issue. Never guess a match or change an amount
    on uncertain evidence, and never report "could not check" as "no issues".
11. **Proposals are not approvals.** A finding is a proposal. Drafts apply only `AUTO_FIX` corrections, `BLOCK`
    holds and human-`ACCEPTED` findings. Accepting a finding is not customer approval of scope, held amounts stay
    visible and unpaid, and portal approval is simulated.

## 7. Git workflow

### Trunk-based workflow (since M1)
- Commit directly to `main`. No feature branches, no PRs, no branch protection. (M0 used a branch and PR #1;
  everything after it is trunk-based.)
- `main` must stay green: `pnpm check` passes before every commit, and every commit is pushed immediately.
- At the end of each milestone, if `gh auth status` succeeds, watch the CI run for the latest push
  (`gh run watch`) and fix any failure right away with a new small commit. Never disable or skip a check.

### Small commits (the most important rule)
- **One logical change per commit.** Each commit builds, passes all checks, and can be reviewed in about 5 minutes.
- **Size:** aim for 50–200 changed lines. **Hard cap: about 300 changed lines**, excluding `pnpm-lock.yaml`,
  generated fixtures and tool-generated scaffolding. If a change would exceed the cap, split it. Typical splits:
  schema first, then logic, then tests; or one injector per commit.
- Put code and its tests in the same commit.
- **Push right after every commit:** `git push` (the first push of a branch uses `git push -u origin <branch>`).
  Never let commits pile up locally.

### Commit messages: Conventional Commits
```
<type>(<scope>): <imperative summary, ≤ 72 chars, no trailing period>

<body: what and why, wrapped at 72 chars. Optional for trivial chores.>
```
- **types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`, `perf`
- **scopes:** `repo`, `domain`, `generator`, `mock-systems`, `rules`, `agent`, `eval`, `web`, `ci`, `deps`

### Before every commit
Run `pnpm check` (Biome check, `tsc -b` typecheck, Vitest). Commit only when it passes.

### Never
- Run `git push --force` on `main`. Force-push to a feature branch only with `--force-with-lease`, and only if I ask.
- Use `--no-verify`, or skip or delete a failing test to get green.
- Amend or rebase commits that are already pushed, unless I ask.
- Commit secrets, `.env`, `node_modules`, generated `data/` (outside `data/fixtures/`), or build output.
- Add a dependency without saying why in the commit body.

### Milestones
- Milestones run back to back without stopping for confirmation. Stop and ask only when a decision is not
  covered by this file or the kickoff plan, or when `pnpm check` still fails after 3 fix attempts.
- Do not add ADRs beyond 0001 unless I ask.

## 8. Commands (keep these working)

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm check` | Lint, typecheck and test. Must pass before every commit |
| `pnpm lint` / `pnpm format` | Biome check / Biome write |
| `pnpm typecheck` | `tsc -b` across workspaces |
| `pnpm test` | Vitest, all packages |
| `pnpm generate -- --seed 42 --jobs 50` | Generate a synthetic batch into `data/` (from milestone M2) |
| `pnpm agent -- --batch data/<batch>` | Run the agent on a batch and write a findings report (from M4) |
| `pnpm eval -- --batch data/<batch>` | Score findings against fault labels (from M5) |
| `pnpm demo` | LLM orchestration of the four demo cases in `data/fixtures/demo/`, offline (scripted, simulated) |
| `pnpm demo -- --llm live` | Same, with a real model for every case (needs `ANTHROPIC_API_KEY`) |

## 9. Definitions of done

**Chunk (one commit):** a single logical change; tests included; `pnpm check` passes; Conventional Commit message;
pushed.

**Milestone:** all chunks pushed to `main`; README and docs updated if behaviour changed; CI green.

## 10. How to report progress to me

After each commit and push, print exactly:

```
✅ <short-hash> <commit message subject>
   files: <list>   (+<added> / -<removed>)
   next:  <one line describing the next chunk>
```

After each milestone, print the CI status and a 3–5 bullet summary of what to look at when reviewing.
