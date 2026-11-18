// Spike D report generator: `node evals/judge-spike/report.ts <run-dir>... [--draft <path>]`.
// Reads result files only; no network, no model.
import { runReportCli } from './lib/report.ts';

process.exitCode = await runReportCli(process.argv.slice(2));
