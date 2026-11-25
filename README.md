# Agentic Dasher

A self-hosted shopping agent. It searches the shops and marketplaces it can reach for a good deal on a product, keeps watching prices, and learns what you like so it can suggest what to look for. It always ends at a link to the merchant: no carts, no checkout, no logins on your behalf.

> **Status: Phase 0 (foundations).** Nothing to shop with yet. The app builds, runs and reports its health. See [`docs/plan.md`](docs/plan.md) for the roadmap and [`docs/progress.md`](docs/progress.md) for what has shipped.

## Run it

```sh
docker compose up -d --build
```

Then open <http://localhost:8080>. Data lives in the `data` Docker volume. Set `PORT` to publish on another port.

## Develop

Requirements: Node.js 26 (`engines >= 24.12`; see `.nvmrc`) and pnpm 12 (`corepack` is not bundled with Node 26, so install pnpm with `npm i -g pnpm@12`).

```sh
pnpm install
pnpm dev          # server on :8080 (node --watch, TypeScript run directly) + Vite on :5173
pnpm check        # lint + typecheck + tests, as CI runs them
pnpm build        # web (Vite) then server (tsdown) into dist/
pnpm start        # run the built server, serving the built SPA
pnpm image:build && pnpm image:budgets   # build the core image and check S§5.14 budgets
```

| Path | What |
|---|---|
| `apps/server` | Hono app: API, SSE, scheduler, jobs, notify, auth, settings |
| `apps/web` | Vite + React SPA |
| `packages/shared` | Zod schemas, API and event types, Money and Currency |
| `packages/core` | Pure domain code, no I/O, no LLM |
| `packages/db` | Drizzle schema, SQL migrations, SQLite access |
| `packages/fetch` | Guard, HTTP transport, wall classifier, pacing, playbook |
| `packages/sources` | Readers, platform routes, store directory |
| `docker/` | Core `Dockerfile` and `compose.yaml` |
| `docs/` | [Spec](docs/spec.md), [plan](docs/plan.md), [progress log](docs/progress.md) |

More packages (`llm`, `agent`) split out when their boundary is real (S§3.2).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to use, modify and share for any non-commercial purpose (personal use, hobby projects, research, charities, schools and other non-commercial organisations). Commercial use is not permitted. Because of that restriction this is not an OSI "open source" licence.
