// Spike D runner CLI. Run by a person, on demand, never in CI: `node evals/judge-spike/run.ts --help`.
// Read evals/judge-spike/README.md first. It makes model calls only with --owner-approved.
import { runCli } from './lib/runner.ts';

process.exitCode = await runCli(process.argv.slice(2), process.env);
