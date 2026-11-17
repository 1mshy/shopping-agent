# Progress log

Per phase: what shipped, measured numbers with sample sizes, and deviations from the spec with reasons (plan, cross-cutting tracks). The newest entry goes at the top of its phase.

## Owner decisions (S§9)

| # | Decision | Status | Value |
|---|---|---|---|
| 1 | Project name and repository | **provisional** | `shopping-agent` (`@shopping-agent/*` packages), repo `1mshy/shopping-agent` |
| 2 | Licence | **provisional** (spec default) | AGPL-3.0-only |
| 4 | robots.txt default | open, needed by Phase 1 | spec default `ignore` |

Provisional items were started on the spec's default and need the owner's confirmation before the Phase 0 exit.

---

## Phase 0: Foundations, contracts and spikes

### 2026-11-17: Workstream 1, repository scaffold

**Shipped**

- pnpm 12 workspace: `apps/server`, `apps/web`, `packages/shared`, `packages/core`, `packages/db` (S§3.2).
- TypeScript 7.0.2 strict, Biome 2.6, Vitest 5.1, tsdown 0.23 (server bundle), Vite 8 + React 19 (placeholder SPA).
- Server: Hono 4.13 on `@hono/node-server` 2.1, `GET /api/health` (status, version, uptime, DB ping, RSS), static SPA with fallback, graceful SIGTERM shutdown. SQLite opened in WAL mode via better-sqlite3 13 and Drizzle 1.0.0-rc.5.
- Core image `docker/Dockerfile` (node:26-trixie-slim, non-root, amd64 + arm64), `docker/compose.yaml` (`init: true`, named data volume, healthcheck), root `compose.yaml` so plain `docker compose up` works.
- CI (`.github/workflows/ci.yml`): lint, typecheck, unit tests, build, multi-arch image build, and the S§5.14 budgets as a failing check (`scripts/check-image-budgets.ts`, limits in `budgets.json`).
- LICENSE (AGPL-3.0), README, CONTRIBUTING, this log; spec and plan moved to `docs/`.

**TypeScript 7 check (plan: confirm Hono and Drizzle inference on day one).** Passed on 7.0.2, so no fallback to 6.x. `apps/server/test/rpc.types.ts` (Hono RPC client response inference) and `packages/db/test/inference.types.ts` (Drizzle select, insert and partial-select inference) are compile-time assertions in `pnpm typecheck`; both were confirmed to fail when an assertion is deliberately broken.

**Budgets, measured locally** (Docker 29.9 on macOS arm64, one run, empty app):

| Metric | Value | Budget |
|---|--:|--:|
| Core pull (gzip of flattened fs) | 88.0 MB | 110 MB |
| Core unpacked | 278.7 MB | 320 MB |
| Idle memory (container, after 5 s) | 26.2 MB | 150 MB |
| Start to healthy (from `docker run`) | 234 ms | 3,000 ms |

Note: the base image is most of the size. Headroom is about 22 MB pulled and 41 MB unpacked for everything Phases 1-7 add to the core. If that runs out, the next lever is a custom base (Node binary on `debian:trixie-slim` without npm), not a budget raise.

**Decisions and deviations**

- **pnpm 12** (spec says pnpm workspaces, no version). Its defaults deny dependency install scripts and enforce a minimum release age; both are kept. `@hono/node-server` is pinned to 2.1.8 because 2.1.9 was published the same day.
- **Node 26 has no corepack.** CI uses `pnpm/action-setup` (reads `packageManager`), and the image installs pnpm with npm in the build stage only.
- **better-sqlite3 13 ships N-API prebuilds for all platforms** and has no install script. The image keeps only the target's `linux-<arch>.node` and drops the C sources (27 MB → 2.7 MB). Because of this, the whole image build runs on the build host's platform and multi-arch needs no QEMU.
- **Workspace packages are consumed as source** and the server runs on Node's type stripping in dev (`.ts` import extensions, `erasableSyntaxOnly`). Only the two apps have a build step.
- Budgets that need later subsystems (RSS during a 30-50-page search; browser add-on figures) are added to `budgets.json` with those subsystems. The SPA first-load budget (200 KB gzip JS, S§5.12) becomes a CI check in Phase 3 as planned; today's placeholder is 70 KB.
