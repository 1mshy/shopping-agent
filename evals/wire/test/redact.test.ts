import { describe, expect, it } from 'vitest';
import { bodyBytes, encodeChunk, serializeFixture } from '../format.ts';
import {
  findSecretLeaks,
  isSensitiveName,
  maskBytes,
  REDACTED,
  redactExchange,
  redactHeaders,
  redactJson,
  redactText,
  selectResponseHeaders,
} from '../redact.ts';
import { syntheticStream } from './synthetic.ts';

const SECRET = 'wire-test-secret-7f3a9c2e5b1d';
const enc = new TextEncoder();
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('names', () => {
  it.each([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'x-goog-api-key',
    'openai-organization',
    'openai-project',
    'x-session-id',
    'api_key',
    'apiKey',
    'access_token',
    'user',
    'user_id',
    'organization',
    'project_id',
  ])('%s is sensitive', (name) => expect(isSensitiveName(name)).toBe(true));

  it.each([
    'content-type',
    'user-agent',
    'x-ratelimit-remaining-tokens',
    'max_tokens',
    'cached_tokens',
    'eos_token',
    'role',
    'model',
  ])('%s is not sensitive', (name) => expect(isSensitiveName(name)).toBe(false));
});

describe('headers', () => {
  it('redacts credentials, cookies and account ids, keeping the auth scheme', () => {
    expect(
      redactHeaders(
        {
          authorization: `Bearer ${SECRET}`,
          cookie: 'session=abc',
          'openai-organization': 'org-abcdefghijklmnopqrstuvwx',
          'content-type': 'application/json',
          'x-echo': `key is ${SECRET}`,
        },
        [SECRET],
      ),
    ).toEqual({
      authorization: `Bearer ${REDACTED}`,
      cookie: REDACTED,
      'openai-organization': REDACTED,
      'content-type': 'application/json',
      'x-echo': `key is ${REDACTED}`,
    });
  });

  it('keeps only allow-listed response headers and lists the names it dropped', () => {
    const { headers, omitted } = selectResponseHeaders([
      ['content-type', 'text/event-stream'],
      ['x-ratelimit-remaining-tokens', '999'],
      ['set-cookie', 'a=b'],
      ['openai-organization', 'org-abcdefghijklmnopqrstuvwx'],
      ['cf-ray', '123'],
      ['content-encoding', 'gzip'],
    ]);
    expect(headers).toEqual({
      'content-type': 'text/event-stream',
      'x-ratelimit-remaining-tokens': '999',
    });
    expect(omitted).toEqual(['cf-ray', 'content-encoding', 'openai-organization', 'set-cookie']);
  });
});

describe('text and JSON', () => {
  it.each([
    [`/v1/models?api_key=${SECRET}&x=1`, `/v1/models?api_key=${REDACTED}&x=1`],
    [`/v1/models?key=abc`, `/v1/models?key=${REDACTED}`],
    [`/proxy/${SECRET}/v1`, `/proxy/${REDACTED}/v1`],
    ['Incorrect API key provided: sk-proj-****abcd', `Incorrect API key provided: ${REDACTED}`],
    ['use sk-or-v1-0123456789abcdef', `use ${REDACTED}`],
    ['header was Bearer abcdefgh12345', `header was Bearer ${REDACTED}`],
    ['owner org-abcdefghijklmnopqrstuvwx', `owner ${REDACTED}`],
    ['model ft:gpt-4o:acme::abc123', `model ${REDACTED}`],
    ['/home/alice/models/q.gguf', `/home/${REDACTED}/models/q.gguf`],
    ['/Users/alice/m.gguf', `/Users/${REDACTED}/m.gguf`],
    ['nothing to see', 'nothing to see'],
  ])('%s', (input, expected) => expect(redactText(input, [SECRET])).toBe(expected));

  it('is idempotent', () => {
    const once = redactText(`Bearer ${SECRET} sk-abcdefgh12345 /home/bob/x`, [SECRET]);
    expect(redactText(once, [SECRET])).toBe(once);
  });

  it('redacts sensitive keys and secret-bearing strings in JSON bodies', () => {
    expect(
      redactJson(
        {
          model: 'm',
          api_key: SECRET,
          user: 'customer-42',
          nested: [{ apiKey: 7 }, `x${SECRET}`],
          max_tokens: 5,
        },
        [SECRET],
      ),
    ).toEqual({
      model: 'm',
      api_key: REDACTED,
      user: REDACTED,
      nested: [{ apiKey: REDACTED }, `x${REDACTED}`],
      max_tokens: 5,
    });
  });
});

describe('bytes', () => {
  it('masks without changing the length, so chunk boundaries stay put', () => {
    const input = enc.encode(`{"error":{"message":"bad key ${SECRET}","user_id":"u-1"}}`);
    const out = maskBytes(input, [SECRET]);
    expect(out.length).toBe(input.length);
    expect(text(out)).not.toContain(SECRET);
    expect(text(out)).not.toContain('u-1');
    expect(text(out)).toContain('"user_id":"***"');
  });

  it('masks a secret split across two chunks in a recorded exchange', () => {
    const f = syntheticStream();
    const whole = enc.encode(`data: {"echo":"${SECRET}"}\n\n`);
    const cut = 16;
    f.response.chunks = [encodeChunk(whole.slice(0, cut), 10), encodeChunk(whole.slice(cut), 20)];
    f.request.headers.authorization = `Bearer ${SECRET}`;
    f.request.path = `/v1/chat/completions?key=${SECRET}`;
    const r = redactExchange(f, [SECRET]);
    expect(r.response.chunks.map((c) => c.atMs)).toEqual([10, 20]);
    expect(bodyBytes(r).length).toBe(whole.length);
    expect(text(bodyBytes(r))).toBe(`data: {"echo":"${'*'.repeat(SECRET.length)}"}\n\n`);
    expect(serializeFixture(r)).not.toContain(SECRET);
    expect(findSecretLeaks(r, [SECRET])).toEqual([]);
  });
});

describe('leak check (fail closed)', () => {
  it('finds the secret in plain text, in base64 chunks and behind JSON unicode escapes', () => {
    const plain = syntheticStream({ model: `m-${SECRET}` });
    expect(findSecretLeaks(plain, [SECRET])).not.toEqual([]);

    const b64 = syntheticStream();
    b64.response.chunks = [{ atMs: 10, base64: Buffer.from(`x${SECRET}`).toString('base64') }];
    expect(findSecretLeaks(b64, [SECRET])).not.toEqual([]);

    const escaped = syntheticStream();
    const u = [...SECRET].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    escaped.response.chunks = [encodeChunk(enc.encode(`{"m":"${u.join('')}"}`), 10)];
    expect(findSecretLeaks(escaped, [SECRET])).not.toEqual([]);
    // Masking cannot see an escaped secret, which is exactly why the check exists.
    expect(findSecretLeaks(redactExchange(escaped, [SECRET]), [SECRET])).not.toEqual([]);
  });

  it('reports nothing for a clean fixture or when there is no secret', () => {
    expect(findSecretLeaks(syntheticStream(), [SECRET])).toEqual([]);
    expect(findSecretLeaks(syntheticStream(), [])).toEqual([]);
  });
});
