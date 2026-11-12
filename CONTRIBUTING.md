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

## Branches

- `main` is always green and deployable. Nobody commits directly to it; every change arrives through a PR.
- Use one branch per milestone, named `<type>/<short-kebab-description>`, for example `feat/domain-model`.

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

## Pull requests

1. Open one PR per milestone with `gh pr create`. The template asks for What, Why, How to test and a checklist.
2. Wait for CI to go green (`gh pr checks --watch`). Fix failures with new small commits, not by amending.
3. A reviewer approves, then the PR is merged with a merge commit (`gh pr merge --merge --delete-branch`) so the
   small commits stay visible on `main`.

## Never

- Force-push to `main`, or rewrite commits that are already pushed.
- Commit secrets, `.env`, `node_modules`, build output or generated `data/` outside `data/fixtures/`.
