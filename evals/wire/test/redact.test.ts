import { describe, expect, it } from 'vitest';
import {
  bodyBytes,
  encodeChunk,
  isSensitiveName,
  REDACTED,
  serializeFixture,
  type WireFixture,
} from '../format.ts';
import { findSecretLeaks } from '../leak-check.ts';
import {
  maskBytes,
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

// Review item 3: echoes the leak check must catch on its own, and that redaction should remove.
describe('echo variants', () => {
  const KEY = 'Zq9xW2vB7nR5/loc4l-k3y';
  const SK = 'sk-or-v1-0a1b2c3d4e5f6a7b8c9dWXYZ';
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const body = (content: string) => `{"error":{"message":"bad token ${content}"}}`;
  const withBody = (raw: string): WireFixture => {
    const f = syntheticStream();
    f.response.chunks = [encodeChunk(enc.encode(raw), 10)];
    return f;
  };
  const cases: [string, string, () => WireFixture][] = [
    ['upper-cased', KEY, () => withBody(body(KEY.toUpperCase()))],
    ['lower-cased', KEY, () => withBody(body(KEY.toLowerCase()))],
    ['with "/" escaped as "\\/"', KEY, () => withBody(body(KEY.replaceAll('/', '\\/')))],
    ['a 12-character prefix', KEY, () => withBody(body(KEY.slice(0, 12)))],
    ['a 10-character suffix', KEY, () => withBody(body(KEY.slice(-10)))],
    ['a short masked sk- echo', SK, () => withBody(body('sk-...WXYZ'))],
    ['URL-encoded twice', KEY, () => withBody(body(encodeURIComponent(encodeURIComponent(KEY))))],
    ['base64, alignment 0', KEY, () => withBody(body(`Basic ${b64(KEY)}`))],
    ['base64, alignment 1', KEY, () => withBody(body(`Basic ${b64(`:${KEY}`)}`))],
    ['base64, alignment 2', KEY, () => withBody(body(`Basic ${b64(`u:${KEY}`)}`))],
    ['base64url', KEY, () => withBody(body(b64url(`ab:${KEY}`)))],
    [
      'lower-cased in a kept rate-limit header',
      KEY,
      () => {
        const f = syntheticStream();
        f.response.headers['x-ratelimit-remaining-requests'] = `99; ${KEY.toLowerCase()}`;
        return f;
      },
    ],
  ];

  it.each(cases)('the leak check finds the key %s', (_name, key, make) => {
    expect(findSecretLeaks(make(), [key])).not.toEqual([]);
  });

  it.each(cases)('redaction removes the key %s', (_name, key, make) => {
    const redacted = redactExchange(make(), [key]);
    expect(findSecretLeaks(redacted, [key])).toEqual([]);
  });

  it('checks extra places such as the output path', () => {
    expect(findSecretLeaks(syntheticStream(), [KEY], { 'output path': `out/${KEY}` })).toEqual([
      'output path',
    ]);
  });
});

// Review item 9: the byte view and the text view must agree on non-ASCII input.
describe('non-ASCII', () => {
  it.each([
    '/Users/Роман/models/x.gguf',
    '/home/nicolàs/m.gguf',
    'path C:\\Users\\Zoë\\m and /home/日本/x',
    'Bearer tökén12345678 and ?key=日本語&x=1',
    'plain café text',
  ])('string-domain and byte-domain redaction keep the same text: %s', (input) => {
    const keptByText = redactText(input, []).split(REDACTED);
    const masked = new TextDecoder('utf-8', { fatal: true }).decode(
      maskBytes(enc.encode(input), []),
    );
    expect(masked.split(/\*+/)).toEqual(keptByText);
  });

  it('masks the whole of a non-ASCII user name', () => {
    expect(text(maskBytes(enc.encode('/Users/Роман/'), []))).toBe(`/Users/${'*'.repeat(10)}/`);
    expect(redactText('/home/nicolàs/x', [])).toBe(`/home/${REDACTED}/x`);
  });
});

// Review item 10: masking must never change JSON validity, SSE framing or byte length.
describe('masking keeps bodies well formed', () => {
  const sse = (events: string[]) => `${events.map((e) => `data: ${e}`).join('\n\n')}\n\n`;
  const bodies: [string, string][] = [
    ['json', '{"content":"see \\"https://x.test/?key=abc\\" now"}'],
    ['json', '{"content":"a?token=xyz\\nnext line","n":1}'],
    ['json', '{"user":"al\\"ice","x":"y"}'],
    ['json', '{"m":"Bearer abcdefgh12345\\\\"}'],
    ['json', `{"m":"\\"${SECRET}\\"","n":"x${SECRET.slice(0, 12)}\\n"}`],
    ['json', '{"p":"/Users/Роман/x","q":"?key=日本語","r":"/home/al\\u00efce/x"}'],
    ['json', '{"e":"Incorrect API key provided: sk-proj-****abcd\\u0021"}'],
    [
      'sse',
      sse([
        '{"choices":[{"delta":{"content":"/home/al\\u00efce/x"}}]}',
        '{"choices":[{"delta":{"content":"?api_key=q\\\\u0041z"}}]}',
        `{"choices":[{"delta":{"content":"${SECRET}"}}]}`,
        '[DONE]',
      ]),
    ],
  ];

  it.each(bodies)('%s body %#', (kind, raw) => {
    const input = enc.encode(raw);
    const out = maskBytes(input, [SECRET]);
    expect(out.length).toBe(input.length);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(out);
    if (kind === 'json') {
      expect(() => JSON.parse(decoded)).not.toThrow();
    } else {
      const before = raw.split('\n\n');
      const after = decoded.split('\n\n');
      expect(after.length).toBe(before.length);
      for (const event of after.filter(Boolean)) {
        expect(event.startsWith('data: ')).toBe(true);
        const data = event.slice('data: '.length);
        if (data !== '[DONE]') expect(() => JSON.parse(data)).not.toThrow();
      }
    }
    expect(decoded).not.toContain(SECRET.slice(0, 8));
  });
});

// Review item 11.
describe('signature', () => {
  it('is sensitive as a header name only', () => {
    expect(isSensitiveName('x-signature', 'header')).toBe(true);
    expect(isSensitiveName('signature')).toBe(false);
    const details = { reasoning_details: [{ type: 'reasoning.text', signature: 'abc123' }] };
    expect(redactJson(details, [])).toEqual(details);
    expect(text(maskBytes(enc.encode(JSON.stringify(details)), []))).toContain('"abc123"');
  });
});

// Review item 5: every meta string goes through the same patterns.
describe('meta', () => {
  it('redacts model, server version, notes and base path', () => {
    const f = syntheticStream({
      model: 'ft:gpt-4o-mini:acme-corp::AbC123',
      serverVersion: 'build at /home/alice/llama.cpp',
      notes: `run by /Users/alice with ${SECRET}`,
      basePath: `/v1/${SECRET}/gw`,
    });
    const r = redactExchange(f, [SECRET]);
    expect(r.meta.model).toBe(REDACTED);
    expect(r.meta.serverVersion).toBe(`build at /home/${REDACTED}/llama.cpp`);
    expect(r.meta.notes).toBe(`run by /Users/${REDACTED} with ${REDACTED}`);
    expect(r.meta.basePath).toBe(`/v1/${REDACTED}/gw`);
  });
});
