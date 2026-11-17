// Wire-fixture recorder CLI. Run on demand, never in CI: `node evals/wire/record.ts --help`.
// See evals/wire/README.md before recording and before committing a recording.
import { runCli } from './recorder.ts';

process.exitCode = await runCli(process.argv.slice(2), process.env);
