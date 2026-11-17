# Contributing

Thanks for helping. Read [`docs/spec.md`](docs/spec.md) (what we build and the rules code enforces) and [`docs/plan.md`](docs/plan.md) (the order we build it in) first. They are short on purpose and they win any argument.

## Setup

Node.js 26 (see `.nvmrc`) and pnpm 12, then:

```sh
pnpm install
pnpm check        # must pass before you open a PR
```

Editor: install the Biome extension. It is the only formatter and linter.

## Ground rules

These come from the spec and the plan. A PR that breaks one is not merged, however good the rest is.

1. **The invariants in S§2 are not negotiable.** In particular: numbers shown to the user never come from a model; prices keep the currency the store bills in and are never converted; the LLM is never on the watch, sweep or alert path; ranking is deterministic code.
2. **Fixtures first.** A behaviour ported from the predecessor lands as a failing golden test before its implementation. Every bug fixed becomes a fixture.
3. **Numbers or it didn't happen.** A change that claims an improvement in matching, coverage, cost or speed shows the eval numbers with sample sizes.
4. **The spec moves with the code.** If you deviate from `docs/spec.md`, update it in the same PR and add a line to `docs/progress.md` saying what and why.
5. **`packages/core` has no I/O.** No `node:` imports, no network, no database, no LLM. Its `tsconfig.json` loads no Node types to keep it honest.
6. **New-major or fragile dependencies sit behind one module** (S§3.3), so they can be swapped. Today that is `packages/db/src/open.ts` for better-sqlite3.
7. **Budgets are CI checks.** Image size, memory and start time are in `budgets.json`. Raising one needs a written reason in the PR and in `docs/progress.md`.

## Code conventions

- TypeScript strict, ESM only. Relative imports include the `.ts` extension (`./app.ts`). The server runs on Node's type stripping in development, so use only erasable syntax: no `enum`, no `namespace`, no parameter properties (`erasableSyntaxOnly` enforces this).
- Workspace packages are consumed as TypeScript source (`exports` points at `src/index.ts`). Only `apps/server` (tsdown) and `apps/web` (Vite) are built.
- `apps/server` is bundled. Its `dependencies` list only what stays external at runtime (native modules such as better-sqlite3); everything else is a `devDependency` and is bundled into `dist/`.
- Tests are `*.test.ts` (Vitest). Compile-time type assertions are `*.types.ts` and are checked by `tsc` only.
- pnpm denies dependency install scripts and enforces a minimum release age. Don't add exclusions to get around them; pin an older version instead.

## Pull requests

- Keep them focused, one concern per PR.
- Describe what changed and how you checked it. Paste eval numbers when they apply.
- CI must be green: lint, typecheck, tests, build, the multi-arch image build and the budget check.

## Licence

By contributing you agree that your contribution is licensed under the project licence, the [PolyForm Noncommercial License 1.0.0](LICENSE). It is source-available: anyone may use, modify and share the code for non-commercial purposes, and commercial use is not permitted.
