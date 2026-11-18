# evals

Gold sets, eval runners, recorded wire fixtures and hand-review files (S§5.16). A workspace package (`@agentic-dasher/evals`) so it is linted, typechecked and tested with everything else. It is excluded from the image (`.dockerignore`).

| Path | What |
|---|---|
| `gold/` | Gold-set formats, the dev/held-out split, agreement tooling, hand-review files |
| `wire/` | Recorded LLM request/SSE fixtures per server family, the recorder and the replay helper |
| `corpus/` | The fixture corpus: golden cases ported from the predecessor before their implementation exists, and the harness that counts them |
| `review/` | The hand-review file format, the converter from the predecessor's review files, and offline rescoring |

Rules:

- Tests here run in CI and must be free: no network, no model call. Anything live or paid is a script that is run on demand.
- A number in a report comes from a run, with its sample size. Labels come from a person.
- Recorded fixtures carry no secrets. The recorder redacts credentials before anything is written.
