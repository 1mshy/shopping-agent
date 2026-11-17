# evals/wire: LLM wire fixtures

Recorded HTTP exchanges with OpenAI-compatible servers (OpenRouter, OpenAI, vLLM, Ollama, llama.cpp). The Phase 2 client and the seven-step capability probe (S§5.7) are tested against them first (P§0 workstream 6, P§2 "Probe matrix"). This directory holds the tooling: the format, the scenario matrix, the recorder and the replay helper. **No recording has been committed yet.** The files under `test/` are hand-written, marked `synthetic: true`, and describe no real server.

| File | What |
|---|---|
| `format.ts` | Zod schema `WireFixtureSchema`, chunk encoding, `parseFixture`, `serializeFixture` |
| `scenarios.ts` | The scenario matrix (`SCENARIOS`), each with its probe step and documentation sources |
| `redact.ts` | Pure redaction (`redactExchange`) and the fail-closed leak check (`findSecretLeaks`) |
| `recorder.ts`, `record.ts` | The recorder and its command line |
| `replay.ts` | `createReplayFetch` and `startReplayServer` for tests |

## Format

One JSON file per exchange, `formatVersion: 1`:

- `meta`: `serverFamily` (`openrouter`, `openai`, `vllm`, `ollama`, `llamacpp`, `other`), `serverVersion` (from `/api/version` on Ollama, `/version` on vLLM, `build_info` in `/props` on llama.cpp, or `--server-version`; else `null`), `model`, `scenario`, `basePath` (path of the base URL, e.g. `/api/v1`), `recordedAt`, `recorderVersion`, `synthetic`, optional `notes`.
- `request`: `method`, `path` (path and query from the server root; the host is not stored), lower-cased `headers` (redacted), JSON `body` or `null`.
- `response`: `status`, `headersAtMs`, `headers` (an allow-list: `content-type`, `cache-control`, `retry-after`, `server`, `openai-version`, `openai-processing-ms`, `x-litellm-response-cost`, `x-ratelimit-*`), `omittedHeaders` (names only, never values), and `chunks`.
- Each chunk is `{atMs, utf8}` when its bytes are valid UTF-8 on their own, else `{atMs, base64}` (for example a character split across two chunks). `atMs` is milliseconds since the request was sent. Concatenating the decoded chunks gives the body byte for byte.

Chunk boundaries are the reads the recorder's `fetch` body reader returned. That is what a fetch-based client sees, but TCP may have merged or split the server's writes on the way. The recorder asks for `accept-encoding: identity`, so the chunks are not decompressed bytes of a gzip stream. If a server compresses anyway, `content-encoding` shows up in `omittedHeaders`.

## Scenarios

`node evals/wire/record.ts --list [--family F]` prints the matrix. Each scenario names the probe step it serves, the families it applies to, and the documentation its request was taken from. Family-only scenarios: `side-door-props` (llama.cpp), `side-door-show` (Ollama), `side-door-model-endpoints` and `reasoning-off-openrouter` (OpenRouter), `reasoning-off-template-kwargs` (vLLM). `cache-prefix-first` must run before `cache-prefix-second`; `--scenarios all` keeps that order. `--max-tokens-field` picks the cap field for the scenarios that are not about the field itself.

## Recording a session

Run by a person, on demand, never in CI. It costs a few cents on hosted endpoints.

```sh
export OPENROUTER_API_KEY=...        # in your shell, never on the command line
node evals/wire/record.ts \
  --base-url https://openrouter.ai/api/v1 --model <author/slug> --family openrouter \
  --api-key-env OPENROUTER_API_KEY --scenarios all --out evals/out/wire
```

Local servers without a key: leave out `--api-key-env`. Write to `evals/out/` (git-ignored), review, then copy what passes the checklist to `evals/wire/fixtures/<family>/<model>/`. The recorder exits 0 when every scenario got an HTTP response (an error status is a valid recording), 1 when a request failed or a leak was refused, and 2 for bad arguments.

## Redaction

Before anything is written:

- Request and response headers whose name looks like a credential or an account id (`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `*-key`, `*token`, `*session*`, `*organization*`, `*project*`, `*user*`, `*account*`, ...) become `[REDACTED]`; `Authorization` keeps its scheme (`Bearer [REDACTED]`). Response headers outside the allow-list are dropped entirely.
- Query parameters and JSON keys with such names, in the path and both bodies.
- Anywhere in the path, headers and bodies: the key itself (raw, JSON-escaped and URL-encoded), `sk-...` keys including masked echoes like `sk-proj-****abcd`, `Bearer <token>`, OpenAI-style `org-`/`user-`/`proj-` ids, `ft:` model ids, and user names in `/home/<name>/` and `/Users/<name>/` paths.
- Response bytes are masked in place with `*` of the same length, across chunk boundaries, so the chunks keep their sizes.

Then the recorder **fails closed**: if the key appears anywhere in the serialized file or the decoded body, including behind JSON `\u` escapes, it writes nothing and stops the session.

Not covered: the key in other encodings (base64, hex), secrets other than the one key (pass only one), personal data in prompts or completions, and identifiers whose name and shape the patterns do not know. That is what the checklist is for.

## Before committing a recording

1. `synthetic` is `false` and the file was produced by `record.ts`, unedited except for redaction you can explain in `notes`.
2. Search the files for the key, for parts of it (first and last 6 characters), and for your account name, e-mail, organisation and project ids.
3. Read every `chunks` entry and every kept header. Nothing identifies you, your machine or your account (paths, host names, request ids that are not needed).
4. `serverVersion` and `model` are right; add `notes` for anything unusual (rate limit, retry, server flags such as llama.cpp `--reasoning-format`).
5. The files parse (`pnpm test` loads them once tests use them) and the PR says which endpoint, when, and roughly what it cost.

## Replay in tests

```ts
const fetch = createReplayFetch([modelsFixture, streamFixture]); // served in order
// ...run the client with { fetch, baseUrl: 'http://127.0.0.1/v1' }...
fetch.assertDone();
```

Each request must match the next fixture: method, path, JSON body (deep equal after the same redaction), the content type, and the presence of `Authorization` when the recording had one. A mismatch rejects the call with `WireReplayMismatchError` and `assertDone()` throws, so a test cannot pass against the wrong fixture. The body stream yields exactly one recorded chunk per read. `startReplayServer` serves the same on `127.0.0.1` with one write per chunk (boundaries usually survive TCP; the fetch form guarantees them), drops the connection on a mismatch, and `close()` rejects. Both take `timing: 'recorded'` to replay the arrival offsets.
