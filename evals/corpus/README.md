# Fixture corpus

Golden cases ported from the predecessor (S§7), written before the code they test (plan P0 workstream 3, CONTRIBUTING rule 2). Each area is one ported behaviour.

```
evals/corpus/
  harness.ts            NotImplementedError, defineArea, corpusTests
  count.ts              prints cases per area and the pending total
  areas/<area-id>/
    area.ts             exports `area` (id, status, sources, cases)
    contract.ts         the types of the subject's input and expected output
    cases/              case data (TypeScript or JSON), saved pages trimmed to what is read
    <area-id>.test.ts   corpusTests(area, run, verify)
```

## How a case fails for the right reason

Until the implementation exists, the test's subject is `notImplemented('<what>')`. A pending case is counted only when the subject throws `NotImplementedError`. A case whose data is malformed, or whose test throws anything else, fails. A subject that answers while its area is still `pending` also fails, so the pending count cannot drift.

When the implementation lands (Phase 1 onwards), its unit replaces the stub with the real function and sets the area's `status` to `implemented`. From then on every case must pass, and a stub left behind fails.

## Rules for an area

- Port behaviour, not code: a case states an input and the expected result, with the predecessor file, test name or report line it came from. Do not guess what the predecessor did; read it.
- `sources` names the predecessor files and the commit they were read at.
- Expected values follow the spec's contracts (`@agentic-dasher/shared`). Where the predecessor's behaviour and the spec disagree, the spec wins and the case says so.
- No money as a float anywhere in a case; amounts are integer minor units with a currency, or the text as read.
- Saved pages are trimmed to what the subject reads, carry no cookies, tokens, account details or personal data, and note their original size.
- Tests are free: no network, no model.

## Commands

```sh
pnpm test                      # proves each pending case throws NotImplementedError and nothing else
node evals/corpus/count.ts     # the gate numbers: cases per area, pending total
```
