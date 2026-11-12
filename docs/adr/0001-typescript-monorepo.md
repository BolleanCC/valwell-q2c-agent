# ADR 0001: TypeScript monorepo with a deterministic core and the LLM at the edges

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

We are building a demo of a quote-to-invoice reconciliation agent for an oilfield service company. It has
several cooperating parts:

- mock source systems (quoting, shop operations, billing, and a customer invoice portal),
- a synthetic data generator that injects labelled faults,
- the agent itself,
- an evaluation harness,
- later, a review web UI.

These parts share one domain vocabulary: quotes and revisions, work orders, change orders, price books, invoices,
findings. If any two parts disagree on a shape, the reconciliation is silently wrong. The domain is also about
money, so arithmetic errors and non-reproducible results are unacceptable. Finally, an LLM can usefully draft
customer-facing text, such as change-order explanations, but it must not be trusted with amounts.

## Decision

1. **One TypeScript monorepo (pnpm workspaces, Node 24, strict ESM).** Packages are `domain`, `generator`,
   `mock-systems`, `rules`, `agent` and `eval`, plus `apps/web` later. Project references (`tsc -b`) typecheck
   them together.
2. **zod schemas in `packages/domain` are the single source of truth.** Every package and the web UI validate data
   at their boundaries with the same schemas, and TypeScript types are derived with `z.infer`. Types are never
   written by hand alongside a schema.
3. **Deterministic core.** Line alignment, rule checks, detectors and routing are pure functions over validated
   data, unit-tested with Vitest. Money is integer cents with a single rounding function. All randomness comes
   from an explicitly passed, seeded PRNG, and a test asserts that the same seed gives byte-identical output.
4. **LLM at the edges.** The LLM sits behind a provider interface in `packages/agent/src/llm/` and is used only to
   draft text from deterministic findings. Guards reject any LLM output whose numbers don't match tool results or
   that cites no evidence ids. Tests and CI use a fake provider.
5. **Isolation via interfaces.** Each mock system owns its store behind a repository interface (JSON files in v1).
   The agent reaches them only through adapter interfaces. The agent never sees fault labels; only `eval` reads them.

## Consequences

- **Positive:** a schema change surfaces as a type error in every consumer at once. Findings are reproducible
  and explainable from evidence ids. Evaluation is exact because every batch carries its own answers. The
  storage and LLM provider can each be swapped without touching the core.
- **Negative:** zod validation adds some runtime cost and boilerplate at boundaries. Project references and
  workspace packaging need care (exports, build order). TypeScript isn't the usual choice for data and ML work,
  so any future modelling beyond LLM calls would cross a language boundary.
- **Follow-ups:** changing any of these decisions needs a new ADR and explicit approval, per CLAUDE.md §4.
