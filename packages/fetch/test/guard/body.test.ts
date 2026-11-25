// The body size cap (S§5.1 "body size cap"), enforced while the body is read, never after: a body
// over the cap stops the read and is refused as `body_size`, whatever Content-Length claimed.
import { describe, expect, test } from 'vitest';
import {
  type BodyResponse,
  type GuardedNet,
  guardedFetch,
  readCapped,
} from '../../src/guard/index.ts';

const PUBLIC = '93.184.215.14';

/** A body that yields `chunks` and records how far it was read and whether it was released. */
function body(chunks: readonly number[], options: { endless?: boolean; failAfter?: number } = {}) {
  const state = { pulled: 0, bytes: 0, released: false };
  const iterable: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (options.failAfter !== undefined && state.pulled >= options.failAfter) {
            throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
          }
          const size = options.endless ? (chunks[0] ?? 1) : chunks[i];
          if (size === undefined) return { done: true, value: undefined };
          i++;
          state.pulled++;
          state.bytes += size;
          return { done: false, value: new Uint8Array(size).fill(65) };
        },
        async return() {
          state.released = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { iterable, state };
}

describe('readCapped', () => {
  test.each([
    [[], 0, 0],
    [[10], 10, 10],
    [[4, 3, 3], 10, 10],
    [[9], 10, 9],
    [[3, 3, 3], 10, 9],
  ])('chunks %j under a cap of %i are read whole (%i bytes)', async (chunks, cap, size) => {
    const b = body(chunks);
    const r = await readCapped(b.iterable, cap);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.bytes.byteLength).toBe(size);
      expect(r.bytes.every((x) => x === 65)).toBe(true);
    }
  });

  test('one byte over the cap is refused', async () => {
    expect((await readCapped(body([11]).iterable, 10)).kind).toBe('too_large');
    expect((await readCapped(body([5, 5, 1]).iterable, 10)).kind).toBe('too_large');
  });

  test('the read stops at the chunk that crosses the cap and the body is released', async () => {
    const b = body([4, 4, 4, 4, 4]);
    expect((await readCapped(b.iterable, 10)).kind).toBe('too_large');
    expect(b.state.pulled).toBe(3);
    expect(b.state.released).toBe(true);
  });

  test('an endless body ends as too large instead of hanging or exhausting memory', async () => {
    const b = body([1024], { endless: true });
    expect((await readCapped(b.iterable, 64 * 1024)).kind).toBe('too_large');
    expect(b.state.bytes).toBe(65 * 1024);
    expect(b.state.released).toBe(true);
  });

  test('a declared Content-Length over the cap is refused before a byte is read', async () => {
    const b = body([1]);
    expect((await readCapped(b.iterable, 10, '11')).kind).toBe('too_large');
    expect(b.state.pulled).toBe(0);
    expect(b.state.released).toBe(true);
  });

  test('a lying Content-Length (small) does not let a large body through', async () => {
    const b = body([8, 8, 8]);
    expect((await readCapped(b.iterable, 10, '5')).kind).toBe('too_large');
    expect(b.state.pulled).toBe(2);
  });

  test.each(['abc', '-1', '1e3', '10, 10', '', ' 5'])(
    'an unusable Content-Length %j is ignored and the count still enforces the cap',
    async (declared) => {
      expect((await readCapped(body([6, 6]).iterable, 10, declared)).kind).toBe('too_large');
      expect((await readCapped(body([6]).iterable, 10, declared)).kind).toBe('ok');
    },
  );

  test('a declared Content-Length at the cap is read', async () => {
    expect((await readCapped(body([10]).iterable, 10, '10')).kind).toBe('ok');
  });

  test('a body that fails mid-read is a transport failure with its code', async () => {
    const r = await readCapped(body([1, 1, 1], { failAfter: 1 }).iterable, 10);
    expect(r).toEqual({ kind: 'failed', code: 'ECONNRESET' });
  });

  test('no body at all is an empty body', async () => {
    const r = await readCapped(null, 10);
    expect(r.kind === 'ok' && r.bytes.byteLength).toBe(0);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'an invalid cap (%s) is a programming error',
    async (cap) => {
      await expect(readCapped(body([1]).iterable, cap)).rejects.toThrow(RangeError);
    },
  );
});

describe('guardedFetch', () => {
  function net(responses: Record<string, Omit<BodyResponse, 'discard'>>) {
    const discarded: string[] = [];
    const n: GuardedNet<BodyResponse> = {
      async lookup() {
        return [PUBLIC];
      },
      async exchange(_address, _port, url) {
        const r = responses[url];
        if (r === undefined) throw new Error(`no reply for ${url}`);
        return { ...r, discard: () => void discarded.push(url) };
      },
    };
    return { net: n, discarded };
  }

  test('a body within the cap is delivered with the final URL and status', async () => {
    const b = body([5, 5]);
    const { net: n } = net({ 'https://store.example/p': { status: 200, body: b.iterable } });
    const r = await guardedFetch({ url: 'https://store.example/p', rung: 'http' }, n, {
      maxBodyBytes: 10,
    });
    expect(r.delivered).toBe(true);
    if (r.delivered) {
      expect(r.finalUrl).toBe('https://store.example/p');
      expect(r.status).toBe(200);
      expect(r.body.byteLength).toBe(10);
    }
  });

  test('a body over the cap is refused as body_size, naming the rung', async () => {
    const b = body([6, 6, 6]);
    const { net: n } = net({
      'https://store.example/p': { status: 200, body: b.iterable, contentLength: '3' },
    });
    const r = await guardedFetch({ url: 'https://store.example/p', rung: 'api' }, n, {
      maxBodyBytes: 10,
    });
    expect(r).toEqual({
      delivered: false,
      outcome: { kind: 'refused_by_policy', rung: 'api', reason: 'body_size' },
    });
    expect(b.state.pulled).toBe(2);
    expect(b.state.released).toBe(true);
  });

  test('a declared size over the cap is refused before the body is read', async () => {
    const b = body([1]);
    const { net: n } = net({
      'https://store.example/p': { status: 200, body: b.iterable, contentLength: '1000' },
    });
    const r = await guardedFetch({ url: 'https://store.example/p', rung: 'http' }, n, {
      maxBodyBytes: 10,
    });
    expect(r.delivered).toBe(false);
    expect(b.state.pulled).toBe(0);
  });

  test("a redirect's body is released, never read against the cap", async () => {
    const redirectBody = body([1000]);
    const final = body([3]);
    const { net: n, discarded } = net({
      'https://store.example/a': { status: 302, location: '/b', body: redirectBody.iterable },
      'https://store.example/b': { status: 200, body: final.iterable },
    });
    const r = await guardedFetch({ url: 'https://store.example/a', rung: 'http' }, n, {
      maxBodyBytes: 10,
    });
    expect(r.delivered && r.finalUrl).toBe('https://store.example/b');
    expect(redirectBody.state.pulled).toBe(0);
    expect(discarded).toEqual(['https://store.example/a']);
  });

  test('a body that fails mid-read is a network error', async () => {
    const b = body([1, 1], { failAfter: 1 });
    const { net: n } = net({ 'https://store.example/p': { status: 200, body: b.iterable } });
    const r = await guardedFetch({ url: 'https://store.example/p', rung: 'http' }, n, {
      maxBodyBytes: 10,
    });
    expect(r).toEqual({
      delivered: false,
      outcome: { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
    });
  });

  test('a guard refusal comes back unchanged and nothing is read', async () => {
    const { net: n } = net({});
    const r = await guardedFetch({ url: 'http://10.0.0.1/', rung: 'http' }, n, {
      maxBodyBytes: 10,
    });
    expect(r).toEqual({
      delivered: false,
      outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
    });
  });
});
