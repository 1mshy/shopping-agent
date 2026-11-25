// The body size cap of the guard (S§5.1 "body size cap"), enforced while the body is read: the
// read stops at the chunk that crosses the cap and the body is released, so an endless or lying
// response costs at most the cap plus one chunk. A declared Content-Length over the cap refuses
// the body before a byte is read; a declared length is never trusted to allow anything.

import { type NetworkError, networkError, type RefusedByPolicy, refusal } from './destination.ts';
import {
  type GuardedNet,
  type GuardedOptions,
  type GuardedRequest,
  guardedExchange,
  type HopResponse,
} from './exchange.ts';

/** A response whose body the guard reads under the cap. */
export interface BodyResponse extends HopResponse {
  /** The Content-Length header as sent, if any; only a plain decimal number is used. */
  readonly contentLength?: string | null | undefined;
  /** The body as it arrives (a web ReadableStream is one); null when there is none. */
  readonly body: AsyncIterable<Uint8Array> | null;
}

export type CappedRead =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'too_large' }
  /** The body failed mid-read; `code` as for a network error. */
  | { readonly kind: 'failed'; readonly code: string };

const DECIMAL = /^\d+$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

async function close(iterator: AsyncIterator<Uint8Array> | undefined): Promise<void> {
  try {
    await iterator?.return?.();
  } catch {
    // Releasing a body we stopped reading is best effort.
  }
}

/** Reads `body` whole if it is at most `maxBytes` long; stops reading as soon as it is not. */
export async function readCapped(
  body: AsyncIterable<Uint8Array> | null | undefined,
  maxBytes: number,
  contentLength?: string | null | undefined,
): Promise<CappedRead> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`maxBytes must be a non-negative safe integer, got ${maxBytes}`);
  }
  if (body === null || body === undefined) return { kind: 'ok', bytes: new Uint8Array() };
  const iterator = body[Symbol.asyncIterator]();
  if (typeof contentLength === 'string' && DECIMAL.test(contentLength)) {
    if (BigInt(contentLength) > BigInt(maxBytes)) {
      await close(iterator);
      return { kind: 'too_large' };
    }
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let next: IteratorResult<Uint8Array>;
    try {
      next = await iterator.next();
    } catch (error) {
      const code = (error as { code?: unknown } | null | undefined)?.code;
      return {
        kind: 'failed',
        code: typeof code === 'string' && CODE.test(code) ? code : 'ERR_BODY',
      };
    }
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await close(iterator);
      return { kind: 'too_large' };
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

export interface GuardedFetchOptions extends GuardedOptions {
  /** The body cap in bytes; a longer body is refused as `body_size`, never truncated. */
  readonly maxBodyBytes: number;
}

export type GuardedFetchResult<R extends BodyResponse = BodyResponse> =
  | {
      readonly delivered: true;
      readonly finalUrl: string;
      readonly status: number;
      readonly response: R;
      readonly body: Uint8Array;
    }
  | { readonly delivered: false; readonly outcome: RefusedByPolicy | NetworkError };

/** One guarded GET (see `guardedExchange`) whose final body is read under the cap. */
export async function guardedFetch<R extends BodyResponse>(
  request: GuardedRequest,
  net: GuardedNet<R>,
  options: GuardedFetchOptions,
): Promise<GuardedFetchResult<R>> {
  const { maxBodyBytes } = options;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new RangeError(`maxBodyBytes must be a non-negative safe integer, got ${maxBodyBytes}`);
  }
  const result = await guardedExchange(request, net, options);
  if (!result.delivered) return result;
  const read = await readCapped(result.response.body, maxBodyBytes, result.response.contentLength);
  if (read.kind === 'too_large') {
    return { delivered: false, outcome: refusal(request.rung, 'body_size') };
  }
  if (read.kind === 'failed') {
    return { delivered: false, outcome: networkError(request.rung, read.code) };
  }
  return { ...result, body: read.bytes };
}
