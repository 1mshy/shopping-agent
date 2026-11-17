// Pure domain code lands here in Phase 0 workstream 2 (money) and Phase 1 (matching, verdicts,
// alert rules). This package must stay free of I/O and LLM dependencies: no `node:` imports,
// no network, no database. `tsconfig.json` deliberately loads no Node types to enforce that.
export {};
