// Pure domain code. This package must stay free of I/O and LLM dependencies: no `node:` imports,
// no network, no database. `tsconfig.json` deliberately loads no Node types to enforce that.
export * from './money.ts';
