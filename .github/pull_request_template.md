## What

<!-- One or two sentences: what does this PR change? -->

## Why

<!-- The problem or milestone goal this addresses. Link issues/ADRs if any. -->

## How to test

<!-- Commands a reviewer can run, and what they should see. -->

```sh
pnpm install
pnpm check
```

## Checklist

- [ ] Commits are small (≤ ~300 changed lines each, excluding lockfile/fixtures) and follow Conventional Commits
- [ ] `pnpm check` passes locally and CI is green
- [ ] Tests added or updated alongside the code they cover
- [ ] Money uses integer-cents helpers; randomness goes through the seeded PRNG
- [ ] Package boundaries respected (`domain` has no internal deps; `agent` does not import `generator`/`eval`)
- [ ] New dependencies are justified in the commit body
- [ ] README / docs / ADRs updated if behaviour or decisions changed
- [ ] No secrets, `.env`, or generated `data/` outside `data/fixtures/`
