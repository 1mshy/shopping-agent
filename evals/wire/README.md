# evals/wire: LLM wire fixtures

Recorded HTTP exchanges with LLM servers: OpenAI-compatible Chat Completions servers (OpenRouter, OpenAI, vLLM, Ollama, llama.cpp, Anthropic's OpenAI compatibility endpoint) and the native Anthropic Messages API. The Phase 2 client and the seven-step capability probe (S§5.7) are tested against them first (P§0 workstream 6, P§2 "Probe matrix"). This directory holds the tooling (the format, two scenario matrices, the recorder, the replay helper and a review script) and the committed recordings under `fixtures/` ([What is committed](#what-is-committed)). The files under `test/` are hand-written, marked `synthetic: true`, and describe no real server.

| File | What |
|---|---|
| `format.ts` | Zod schema `WireFixtureSchema`, chunk encoding, `parseFixture`, `serializeFixture`; the families and which wire shape each speaks |
| `scenarios.ts`, `scenarios-messages.ts`, `prompts.ts` | The scenario matrices (`SCENARIOS`: Chat Completions, then Messages), each scenario with its probe step and documentation sources; the prompts both share |
| `redact.ts` | Pure redaction (`redactExchange`) |
| `leak-check.ts` | The fail-closed net (`findSecretLeaks`), independent of `redact.ts` |
| `recorder.ts`, `record.ts` | The recorder and its command line |
| `review.ts` | The mechanical half of the checklist below: counts only |
| `replay.ts`, `replay-vitest.ts` | Replay, and the Vitest helpers tests should use |
| `fixtures/` | Committed, reviewed recordings (`synthetic: false`); `test/fixtures.test.ts` parses and replays every one |

## Two wire shapes

| | Chat Completions (every family but `anthropic`) | Messages (`--family anthropic`) |
|---|---|---|
| Endpoint | `POST {base}/chat/completions` | `POST {base}/messages`, `POST {base}/messages/count_tokens`, `GET {base}/models[/{id}]` |
| Key | `Authorization: Bearer <key>` | `x-api-key: <key>` |
| Version | none | `anthropic-version: 2026-10-21` (`ANTHROPIC_VERSION` in `format.ts`), on every request |
| Scenarios | `scenarios.ts` (ids without prefix) | `scenarios-messages.ts` (ids `messages-*`) |

A scenario carries its wire shape (`api`) and only applies to families that speak it. Anthropic's OpenAI compatibility endpoint (`https://api.anthropic.com/v1/chat/completions`, documented at https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk, read 2026-11-24) is the family `anthropic-compat`: it takes the Chat Completions matrix with a bearer key, like any other OpenAI-compatible server.

## Format

One JSON file per exchange, `formatVersion: 1`:

- **`meta`**:
  - `serverFamily`: one of `openrouter`, `openai`, `vllm`, `ollama`, `llamacpp`, `anthropic` (the native Messages API), `anthropic-compat` (Anthropic's OpenAI compatibility endpoint), `other`.
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
  - `headers`: an allow-list of `content-type`, `cache-control`, `retry-after`, `server`, `openai-version`, `openai-processing-ms`, `x-litellm-response-cost`, `x-should-retry`, `x-ratelimit-*` and `anthropic-ratelimit-*`. Rate-limit and retry headers are kept because a client's backoff reads them; they carry limits, counts and reset times, no identifier. Request and account identifiers (`request-id`, `x-request-id`, `anthropic-organization-id`, `anthropic-workspace-id`, `traceresponse`, `cf-ray`) are not on the list.
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
  - every `messages-*` scenario: `anthropic`.
- **`tool-choice-none`** and **`messages-tool-choice-none`** record how a server answers the forced finish (S§5.7).
- **Order.** A cache pair's second scenario names its first in `mustFollow` (`cache-prefix-second` after `cache-prefix-first`, `messages-cache-second` after `messages-cache-first`). `--scenarios all` keeps that order, and the recorder refuses any other.
- **`--max-tokens-field`** picks the cap field for the Chat Completions scenarios that are not about the field itself. Messages has one cap field, `max_tokens`.

### The Messages matrix

Request shapes from Anthropic's documentation, read 2026-11-24; each scenario cites its pages. Thinking is left at the model's default unless the scenario is about it, and no sampling parameter is sent.

| Scenario | Probe step | Request |
|---|---|---|
| `messages-models-list` | 1 | `GET /models` (first page, default `limit` 20) |
| `messages-model-get` | 1 | `GET /models/{model}`: context window, output cap, capabilities |
| `messages-stream` | 2 | Plain streamed reply, `max_tokens` 512 |
| `messages-nonstream` | client | The same, `stream: false` |
| `messages-stream-max-tokens` | 2 | Count to 200 with `max_tokens` 16 |
| `messages-tool-auto` | 3 | One tool, `tool_choice: {type: "auto"}` |
| `messages-tool-result-followup` | 3 | A `tool_use` (id `toolu_wire_1`) and its `tool_result`, no thinking block in the replayed turn |
| `messages-tool-choice-any-parallel` | 4 | `tool_choice: {type: "any"}`, two stores asked for |
| `messages-tool-choice-none` | forced finish | Tools supplied, `tool_choice: {type: "none"}` |
| `messages-json-schema` | 5 | `output_config.format: {type: "json_schema", schema}` |
| `messages-thinking-summarized` | 2, 6 | `thinking: {type: "adaptive", display: "summarized"}`, `output_config.effort: "low"` |
| `messages-thinking-disabled` | 6 | `thinking: {type: "disabled"}`, effort `low` |
| `messages-cache-first`, `messages-cache-second` | 7 | The long byte-stable prefix of the Chat Completions cache pair (3,628 tokens on Haiku 5.5) as a `system` text block with `cache_control: {type: "ephemeral"}` (an explicit breakpoint: the automatic one would land on the user turn, which differs between the two) |
| `messages-count-tokens` | client | `POST /messages/count_tokens` with system, one tool and the question of `messages-tool-auto` |
| `messages-error-bad-credentials`, `-unknown-model`, `-rejected-request`, `-sampling` | client | A wrong key; an unknown model; `messages` not an array; `temperature: 0` |

No Messages counterpart, so no scenario: `json_object` mode (structured outputs only), a choice of cap field, a developer role (the system prompt is top-level), native side doors other than `GET /models/{id}`.

## Recording a session

Run by a person, on demand, never in CI. It costs a few cents on hosted endpoints.

```sh
export MY_RECORDING_KEY=...          # in your shell, never on the command line
node evals/wire/record.ts \
  --base-url https://openrouter.ai/api/v1 --model <author/slug> --family openrouter \
  --api-key-env MY_RECORDING_KEY --label <short-name> --scenarios all --out evals/out/wire
```

For the Messages API, `--family anthropic --base-url https://api.anthropic.com/v1`; the recorder sends the key as `x-api-key` and adds `anthropic-version`. A key kept in a `.env` file can be loaded into the recorder's own process with `node --env-file=<path> evals/wire/record.ts … --api-key-env NAME`, so it never appears in the shell or on the command line.

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
- **Query parameters and JSON string fields** with such names, except `signature`, which stays readable in bodies (OpenRouter `reasoning_details[].signature` is not a credential). Anthropic's thinking blobs are the exception below.
- **Each secret** (the key and every `--redact-env` value), matched case-insensitively:
  - raw, JSON-escaped (also with `\/`), and URL-encoded once and twice;
  - base64 and base64url at all three byte alignments;
  - any run of 8 or more of its characters.
- **Known shapes:**
  - `sk-...` keys of three or more characters after the dash, including masked echoes like `sk-...WXYZ`;
  - `Bearer <token>` and `Basic <token>`;
  - OpenAI-style `org-`, `user-` and `proj-` ids;
  - Anthropic request ids (`req_…`, in error bodies) and message ids (`msg_…`, in every Messages reply and in every compatibility-endpoint chunk), masked after the prefix: each names one request in Anthropic's logs and no test needs it. Tool-use ids (`toolu_…`) are kept;
  - Anthropic thinking blobs, all but their first 8 characters: the `signature` of a `signature_delta` and of a `thinking` block, and the `data` of a `redacted_thinking` block (and the same fields in a request body that sends such a block back). They are opaque, encrypted, and bound to something (account or conversation) that cannot be checked from outside, and this repository is public. Values of 8 characters or fewer, such as the empty `signature` of `content_block_start`, are untouched, and so is any other `signature` field (OpenRouter's);
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
4. Check that the stream ends as it should (Chat Completions: `data: [DONE]` or a final usage chunk; Messages: `event: message_stop`, or an `event: error`). A truncated body is recorded as received.
5. Check that the `*` masks hide only what they should. Model text that looked like a secret is masked too; that is accepted, but say so in `notes` if it changes what a test can assert.
6. `serverVersion` and `model` are right. Add `notes` for anything unusual: a rate limit, a retry, server flags such as llama.cpp `--reasoning-format`.
7. The files parse (`parseFixture`), and the PR says which endpoint, when, and roughly what it cost.

`node evals/wire/review.ts <dir> --key-env NAME` does the mechanical part of items 1, 2, 4 and 5 and adds up the cost: per file it prints the status, how the body ends, the kept header names, the mask runs, the usage, and counts of key pieces (the leak check's forms), unmasked `req_`/`msg_` ids, unmasked thinking blobs, `file_`/`batch_`/`container_` ids and non-null `container` values, UUIDs, e-mail addresses, IPv4 addresses, host names and the local user and host names; never a value. It exits 1 when a count that must be zero is not. Reading every chunk and header is still yours.

Committed fixtures live in `fixtures/<family>/<label>/`, unedited copies of what `record.ts` wrote. `fixtures/biome.json` turns Biome's formatter off there, so `pnpm lint` does not ask for the recorder's `JSON.stringify` layout to be rewritten.

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
- the presence of `Authorization`, and of `x-api-key`, when the recording had one;
- `anthropic-version` and `anthropic-beta`, which must equal the recorded values (absent on both sides counts as equal): the Messages API's shape depends on them.

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

## What is committed

| Set | Endpoint | Recorded | Model | Files |
|---|---|---|---|---|
| `fixtures/anthropic/claude-haiku-5-5/` | Messages API, `https://api.anthropic.com/v1`, `anthropic-version: 2026-10-21` | 2026-11-24, 15:49:20 to 15:49:29 UTC; `messages-thinking-summarized` re-recorded alone at 16:01:37 UTC, after the signature-masking rule was added | `claude-haiku-5-5` | 19: every `messages-*` scenario; 15 HTTP 200, one each of 401, 404 and two 400 |
| `fixtures/anthropic-compat/claude-haiku-5-5/` | OpenAI compatibility endpoint, `https://api.anthropic.com/v1/chat/completions` (and `/v1/models`) | 2026-11-24, 15:50:12 to 15:50:19 UTC | `claude-haiku-5-5` | 19: every Chat Completions scenario that applies (all but the side doors); 14 HTTP 200, one each of 401 and 404, and three 400 |

One session each, sequential, no retries, plus the one re-recorded scenario; no file was edited after `record.ts` wrote it. Usage the committed bodies report, at Haiku 5.5 list prices ($0.10 / $0.50 per million input / output tokens, cache writes $0.125, cache reads $0.01): Messages 2,552 input, 3,628 cache-write, 3,628 cache-read and 370 output tokens, $0.00093; compatibility endpoint 9,898 input and 392 output tokens, $0.00119. Spent in all, the superseded first `messages-thinking-summarized` (52 input, 38 output tokens, $0.000024) included: $0.0021. Token counting and the model endpoints are not billed.

## What the recordings show a client must handle

Observations of these 38 recordings, one exchange per scenario, not guarantees.

**Messages API (19).**
- **Streams** (11 of the 15 HTTP 200s): named SSE events, `event: <type>` then `data: <json>` whose `type` repeats the event name. All 11 begin with `message_start` and end with `message_delta` then `message_stop`; there is no `[DONE]`. 10 of 11 carry one `event: ping` after the first `content_block_start`; the `tool_choice: none` stream has no content block and no ping. In all 11, `data` JSON is padded with spaces before its closing brace (`…}   }`): parse it as JSON, never match it as text. Content type `text/event-stream; charset=utf-8`.
- **Usage.** `message_start.message.usage` has `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`, a provisional `output_tokens` (3 of 11 equal the final count) and `service_tier` / `inference_geo` / `speed`. The final `message_delta.usage` repeats the input-side counts and adds the final `output_tokens` and `output_tokens_details.thinking_tokens`; the non-streamed reply has all of them in `usage`. `input_tokens` excludes cache reads and writes (cache pair: 17 + 3,628 written, then 16 + 3,628 read).
- **Thinking.** With `thinking` omitted (Haiku 5.5's default: adaptive, display omitted, effort medium) none of the 10 inference requests that left it at the default produced a thinking block, and `thinking_tokens` was 0 in each. With `display: "summarized"` at effort `low`: a `thinking` block at index 0 (`thinking_delta` text, then one `signature_delta` with an opaque base64 signature, 884 characters in the committed file), then the text block; `thinking_tokens` 35 of `output_tokens` 38 in both recordings, so thinking is part of `output_tokens`. A client must pass a thinking block back unchanged, signature included, in the next turn of a tool loop. The committed signature is masked after its first 8 characters (Redaction), so that recording cannot be replayed to the real API; a test that needs a real round trip must record its own. `thinking: {type: "disabled"}` at effort `low` was accepted: no thinking block, `thinking_tokens` 0.
- **Stop reasons seen:** `end_turn` (9), `tool_use` (2), `max_tokens` (1, after the text `1 2 3 4 5 6 7 8 `). Every message carries `stop_details: null`, `container: null` and `diagnostics: null`.
- **Tools.** A `tool_use` block opens with `input: {}` and `caller: {type: "direct"}`; the input arrives as `input_json_delta` fragments, the first one empty. `tool_choice: any` gave two parallel `tool_use` blocks (Amazon, Best Buy) and no thinking block. A `tool_result` for a `tool_use` turn sent without a thinking block was accepted (200).
- **Forced finish:** `tool_choice: {type: "none"}` with tools supplied was accepted, and the reply was **empty**: no content block at all, `stop_reason: end_turn`, `output_tokens` 1. The compatibility endpoint did the same (no content delta, `finish_reason: stop`, `completion_tokens` 1). A finisher that relies on this call for a final text needs a fallback.
- **Structured output:** the JSON arrives as a `text` block (`{"brand": "Amazon", "model": "Kindle Paperwhite"}`), `stop_reason: end_turn`.
- **Token counting** returns `{"input_tokens": 448}`, equal to the `input_tokens` of `messages-tool-auto`, which sends the same system, tool and question.
- **Model record:** `max_input_tokens` 1,000,000, `max_tokens` 128,000; `thinking.types`: `adaptive` and `disabled` supported, `enabled` and `between_tools` not; effort `low` to `max` all supported. The list returned 14 models in one page (`has_more: false`).
- **Errors** are `{"type": "error", "error": {"type", "message"}, "request_id"}` with `x-should-retry: false` (4 of 4): wrong key 401 `authentication_error` "invalid x-api-key"; unknown model 404 `not_found_error` "model: …"; malformed 400 `invalid_request_error` "messages: Input should be a valid array"; `temperature: 0` 400 `invalid_request_error` "temperature: Extra inputs are not permitted" (API version 2026-10-21 removes sampling parameters).
- **Headers:** the 12 inference replies with a 200 carry 12 `anthropic-ratelimit-*` headers (requests, tokens, input-tokens, output-tokens: limit, remaining, reset); the model endpoints, the token count and the errors carry none.

**OpenAI compatibility endpoint (19).**
- **Streams** (13 of the 14 HTTP 200s): data-only SSE ending `data: [DONE]`, content type `text/event-stream` (no charset), no ping. The first chunk carries only `delta.role`. Usage comes in the chunk that carries `finish_reason` (not in a separate chunk with empty `choices`) and holds only `prompt_tokens`, `completion_tokens` and `total_tokens`: no `prompt_tokens_details` or `completion_tokens_details` key at all. Every chunk repeats `id` (a `msg_…` id), `created`, `model` and `object`. `data` JSON is padded with spaces as on the Messages API (13 of 13).
- **Prompt tokens equal the Messages API's `input_tokens`** for the same request, in every comparable pair (45 for the plain reply streamed and not, 51 for both cap fields, 261, 448 for tool auto and none, 543, 575); the cache pair's 3,645 and 3,644 equal the Messages API's `input_tokens` plus cache tokens (17 + 3,628, 16 + 3,628). Completion tokens equal `output_tokens` where the reply text was the same (4, 16, 29, 80, 148, 1) and differ by one in the tool-result follow-up, whose wording differed (41 against 40).
- **No cache:** the cache pair reports 3,645 and 3,644 prompt tokens and no cached count (the documentation says prompt caching is not supported here).
- **No visible reasoning:** `reasoning_effort` `low` and `none` were both accepted (the documentation says the field is ignored); `reasoning-on` billed 38 completion tokens for the visible reply "No", with no reasoning field.
- **Accepted:** `max_tokens` and `max_completion_tokens` (both stop at 16 with `finish_reason: length`), the `developer` role, `tool_choice: required` with `parallel_tool_calls` (two calls; ids are `toolu_…`), `tool_choice: none` (empty reply, above), `response_format` `json_schema` strict. A tool call opens with `id`, `name` and empty `arguments`, then one more empty `arguments` delta before the fragments.
- **Refused:** `response_format: json_object` 400 "response_format.type: Input should be 'json_schema'"; `GET /v1/models` with a bearer key and no `anthropic-version` 400 "anthropic-version: header is required" in the Messages API's error shape: the model list is not part of the compatibility layer.
- **Errors** are OpenAI-shaped, `{"error": {"code", "message", "type", "param"}}`, with `type` `invalid_request_error` in all three and the distinction in `code` (`authentication_error` "Invalid Anthropic API Key" 401, `not_found_error` 404, `invalid_request_error` 400); no `request_id` in the body and no `x-should-retry`.
- **Headers:** `x-ratelimit-requests`, `x-ratelimit-tokens`, `x-ratelimit-remaining-*` and `x-ratelimit-reset-*` (as durations, `0s`) on the 14 inference 200s; `x-request-id` is dropped.
