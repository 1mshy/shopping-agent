# evals/wire: LLM wire fixtures

Recorded HTTP exchanges with OpenAI-compatible servers (OpenRouter, OpenAI, vLLM, Ollama, llama.cpp). The Phase 2 client and the seven-step capability probe (S§5.7) are tested against them first (P§0 workstream 6, P§2 "Probe matrix"). This directory holds the tooling: the format, the scenario matrix, the recorder and the replay helper. **No recording has been committed yet.** The files under `test/` are hand-written, marked `synthetic: true`, and describe no real server.

| File | What |
|---|---|
| `format.ts` | Zod schema `WireFixtureSchema`, chunk encoding, `parseFixture`, `serializeFixture` |
| `scenarios.ts` | The scenario matrix (`SCENARIOS`), each with its probe step and documentation sources |
| `redact.ts` | Pure redaction (`redactExchange`) |
| `leak-check.ts` | The fail-closed net (`findSecretLeaks`), independent of `redact.ts` |
| `recorder.ts`, `record.ts` | The recorder and its command line |
| `replay.ts`, `replay-vitest.ts` | Replay, and the Vitest helpers tests should use |

## Format

One JSON file per exchange, `formatVersion: 1`:

- **`meta`**:
  - `serverFamily`: one of `openrouter`, `openai`, `vllm`, `ollama`, `llamacpp`, `other`.
  - `serverVersion`: from `/api/version` on Ollama, `/version` on vLLM, `build_info` in `/props` on llama.cpp, or `--server-version`; otherwise `null`.
  - `model`, `scenario`, `basePath` (the path of the base URL, e.g. `/api/v1`), `recordedAt`, `recorderVersion`, `synthetic`, and optional `notes`.
  - Every string in `meta` is redacted.
- **`request`**:
  - `method`, and `path` (path and query from the server root; the host is not stored).
  - `headers`: lower-cased and redacted. These are the headers the recorder set, not everything on the wire. fetch (undici) adds its own, such as `host`, `connection`, `accept-language` and `sec-fetch-mode`.
  - The JSON `body`, or `null`.
- **`response`**:
  - `status`: 200 to 599.
  - `headersAtMs`.
  - `headers`: an allow-list of `content-type`, `cache-control`, `retry-after`, `server`, `openai-version`, `openai-processing-ms`, `x-litellm-response-cost` and `x-ratelimit-*`.
  - `omittedHeaders`: names only, never values.
  - `chunks`: empty for 204, 205 and 304.
- **Chunks.** Each chunk is `{atMs, utf8}` when its bytes are well-formed UTF-8 on their own, otherwise `{atMs, base64}` in canonical base64 (for example a character split across two chunks). `atMs` is milliseconds since the request was sent. Concatenating the decoded chunks gives the body byte for byte.
- **Schema checks.** Any credential-like header must hold `[REDACTED]` or `<Scheme> [REDACTED]`, or the schema rejects the file.

**Chunk boundaries** are the reads the recorder's `fetch` body reader returned. That is what a fetch-based client sees, but TCP may have merged or split the server's writes on the way.

**Compression.** The recorder asks for `accept-encoding: identity`, so the chunks are not decompressed bytes of a gzip stream. If a server compresses anyway, `content-encoding` shows up in `omittedHeaders`.

**Truncated bodies.** A body cut short by a closed connection on a 200 is recorded as it arrived, without comment. Check the end of a stream before committing it.

## Scenarios

`node evals/wire/record.ts --list [--family F]` prints the matrix. Each scenario names the probe step it serves, the families it applies to, and the documentation its request was taken from.

- **Family-only scenarios:**
  - `side-door-props`: llama.cpp.
  - `side-door-show`: Ollama.
  - `side-door-model-endpoints` and `reasoning-off-openrouter`: OpenRouter.
  - `reasoning-off-template-kwargs`: vLLM.
- **`tool-choice-none`** records how a server answers the forced finish (S§5.7).
- **Order.** `cache-prefix-second` must come immediately after `cache-prefix-first`. `--scenarios all` keeps that order, and the recorder refuses any other.
- **`--max-tokens-field`** picks the cap field for the scenarios that are not about the field itself.

## Recording a session

Run by a person, on demand, never in CI. It costs a few cents on hosted endpoints.

```sh
export MY_RECORDING_KEY=...          # in your shell, never on the command line
node evals/wire/record.ts \
  --base-url https://openrouter.ai/api/v1 --model <author/slug> --family openrouter \
  --api-key-env MY_RECORDING_KEY --label <short-name> --scenarios all --out evals/out/wire
```

- **Keys.** The key, and every `--redact-env` value, must be at least 16 printable ASCII characters with no whitespace. A server that needs no key is recorded without `--api-key-env`.
- **Account ids in the base URL.** Pass `--redact-env NAME` (repeatable) for any other value that must not appear, such as an account id in a gateway's base path.
- **Base URL.** It must not carry user-info or a query string.
- **What is checked before the first request.** Every argument is validated, and no error message quotes an argument or a secret.
- **Exit codes.** 0 when every scenario got a non-redirect HTTP response (an error status is a valid recording). 1 when a request failed, a redirect came back, or a leak was refused. 2 for bad arguments.

**Output.** The session records into a staging directory next to `--out`. The files move to `<out>/<family>/<label or encoded model id>/<scenario>.json` only if every exchange passed the leak check. On a leak, the staging directory is deleted and nothing from the session is written. Existing fixture files are not overwritten without `--overwrite`.

**After recording.** Write to `evals/out/` (git-ignored) and review. Then copy what passes the checklist to `evals/wire/fixtures/<family>/<label>/`.

## Redaction

Applied to `meta`, the request path, headers and body, and the response headers and body, before anything is written:

- **Credential-like names.** Headers whose name looks like a credential or an account id become `[REDACTED]`. That covers:
  - `authorization`, `proxy-authorization`, `cookie`, `set-cookie`;
  - names ending in `key` or `token`;
  - names containing `session`, `secret`, `password`, `organization`, `project`, `user` or `account`;
  - names containing `signature` (headers only).

  `Authorization` keeps its scheme (`Bearer [REDACTED]`).
- **Dropped headers.** Response headers outside the allow-list are dropped entirely.
- **Query parameters and JSON string fields** with such names, except `signature`, which stays readable in bodies (OpenRouter `reasoning_details[].signature` is not a credential).
- **Each secret** (the key and every `--redact-env` value), matched case-insensitively:
  - raw, JSON-escaped (also with `\/`), and URL-encoded once and twice;
  - base64 and base64url at all three byte alignments;
  - any run of 8 or more of its characters.
- **Known shapes:**
  - `sk-...` keys of three or more characters after the dash, including masked echoes like `sk-...WXYZ`;
  - `Bearer <token>` and `Basic <token>`;
  - OpenAI-style `org-`, `user-` and `proj-` ids;
  - `ft:` model ids;
  - user names in `/home/<name>/`, `/Users/<name>/` and `\Users\<name>\` paths.
- **Response bytes** are masked in place with `*` of the same length, across chunk boundaries. Masks are widened so they never split a JSON escape or a UTF-8 character, so the chunks keep their sizes, JSON stays valid and SSE framing is unchanged.

**The accepted cost.** Model output that merely looks like a secret is masked too: `sk-learn-pipeline`, `Bearer tokens1234`, `Basic information`, `/home/runner/`. Such a recording is still a faithful record of the wire, apart from those bytes.

**The leak check fails closed.** After redaction, `leak-check.ts` runs its own stricter search over the serialized file, the decoded body and the output path. It shares no code or form list with redaction.
- It searches case-insensitively, after JSON unescaping and after URL-decoding once and twice.
- It looks for any 8-character run of a secret, its base64 and base64url at every alignment, and a masked echo ending in its last four characters.
- On a hit, nothing from the session is written.

**Not covered:**
- secrets in encodings other than those above (hex, other ciphers or encodings);
- secrets you did not pass with `--api-key-env` or `--redact-env`;
- personal data inside prompts or completions;
- host names and LAN addresses;
- identifiers whose name and shape the patterns do not know.

The checklist below covers these.

## Before committing a recording

1. `synthetic` is `false`, and the file was produced by `record.ts`, unedited. If you had to change anything, say why in `notes`.
2. Search the files, case-insensitively, for:
   - the key and any 8-character piece of it;
   - your account name, e-mail, organisation and project ids;
   - host names and IP addresses.
3. Read every `chunks` entry and every kept header. Nothing should identify you, your machine or your account: paths, host names, request ids that are not needed.
4. Check that the stream ends as it should (`data: [DONE]` or a final usage chunk). A truncated body is recorded as received.
5. Check that the `*` masks hide only what they should. Model text that looked like a secret is masked too; that is accepted, but say so in `notes` if it changes what a test can assert.
6. `serverVersion` and `model` are right. Add `notes` for anything unusual: a rate limit, a retry, server flags such as llama.cpp `--reasoning-format`.
7. The files parse (`parseFixture`), and the PR says which endpoint, when, and roughly what it cost.

## Replay in tests

Use the Vitest helpers. They tie the final check to the test, so a mismatch fails the test even when the client under test swallows the rejected call.

```ts
import { useReplayFetch, useReplayServer } from '../wire/replay-vitest.ts';

it('streams', async () => {
  const fetch = useReplayFetch([modelsFixture, streamFixture]); // served in order
  // ...run the client with { fetch, baseUrl: 'http://127.0.0.1/v1' }...
});
```

**What must match.** Each request must match the next fixture on:
- the method;
- the path;
- the JSON body (deep equal);
- the content type;
- the presence of `Authorization` when the recording had one.

**Comparison happens after redaction.** The received path and body are redacted the same way before comparing, so two requests that differ only in a redacted field compare equal.

**Order.** Each call claims its fixture slot when it is made, so concurrent calls are matched in call order.

**A mismatch:**
- rejects the call with `WireReplayMismatchError`;
- fails the test at teardown;
- also fails the test when a recorded exchange was never requested.

**The two forms.**
- `useReplayFetch` (or `createReplayFetch` with a manual `assertDone()`) yields exactly one recorded chunk per read.
- `useReplayServer` (or `startReplayServer` with `close()`) serves the same on `127.0.0.1`, with one write per chunk. Boundaries normally survive TCP; the fetch form guarantees them. It drops the connection on a mismatch.
- Both take `timing: 'recorded'` to replay the arrival offsets.
