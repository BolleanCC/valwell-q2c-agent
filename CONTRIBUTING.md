# Contributing

This is a summary of the workflow. [CLAUDE.md](CLAUDE.md) is the binding rulebook. If the two disagree,
CLAUDE.md wins.

## Setup

```sh
# Node 24 (see .node-version) and pnpm (version pinned in package.json)
corepack enable        # or install pnpm yourself
pnpm install           # also installs the git hooks via lefthook
pnpm check             # lint + typecheck + test; must pass before every commit
```

## Trunk-based workflow

- Commit directly to `main`. There are no feature branches or PRs.
- `main` must stay green: run `pnpm check` before every commit and push immediately after.

## Commits

- **One logical change per commit.** Each commit builds, passes `pnpm check` and takes about 5 minutes to review.
- **Size:** aim for 50–200 changed lines, with a hard cap of about 300 (the lockfile, generated fixtures and
  scaffolding don't count). Split larger changes: schema, then logic, then tests, or one injector per commit.
- Put code and its tests in the same commit.
- Push right after each commit.
- Explain every new dependency in the commit body.

### Message format ([Conventional Commits](https://www.conventionalcommits.org/))

```
<type>(<scope>): <imperative summary, ≤ 72 chars, no trailing period>

<body: what and why, wrapped at 72 chars>
```

| | Allowed values |
| --- | --- |
| type | `feat` `fix` `refactor` `test` `docs` `chore` `ci` `build` `perf` |
| scope | `repo` `domain` `generator` `mock-systems` `rules` `agent` `eval` `web` `ci` `deps` |

The `commit-msg` hook and the CI `commitlint` job enforce this format.

## Hooks

lefthook installs the hooks when you run `pnpm install`:

- **pre-commit:** runs Biome on staged files (check only). Run `pnpm format` to apply fixes.
- **commit-msg:** runs commitlint.

Never bypass them with `--no-verify`, and never skip or delete a failing test.

## CI

CI runs on every push to `main`. If it fails, fix it with a new small commit; don't amend or revert history.

## Never

- Force-push to `main`, or rewrite commits that are already pushed.
- Commit secrets, `.env`, `node_modules`, build output or generated `data/` outside `data/fixtures/`.
