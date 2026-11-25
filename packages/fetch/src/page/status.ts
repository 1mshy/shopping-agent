// The outcome of a response by its status alone (S§5.1 "Typed outcome"), once the classifier has
// had no opinion.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';
import { parseRetryAfter } from './retry-after.ts';

/**
 * 2xx `ok`; 404 and 410 `not_found`; 401 `login_required`; 402 `payment_required`; 429
 * `rate_limited` with its Retry-After; 5xx `server_error`. Any other status (a 3xx that was not
 * followed, a 400, a 451) has no kind of its own in S§5.1 and is reported as a `network_error`
 * whose code is `HTTP_<status>`: not ok, never read, and never a reason to move a rung.
 */
export function statusOutcome(
  rung: Rung,
  status: number,
  retryAfter: string | null | undefined,
  now: number,
): FetchOutcome {
  if (status >= 200 && status <= 299) return { kind: 'ok', rung };
  if (status === 404 || status === 410) return { kind: 'not_found', rung };
  if (status === 401) return { kind: 'login_required', rung };
  if (status === 402) return { kind: 'payment_required', rung };
  if (status === 429) {
    return { kind: 'rate_limited', rung, retryAfterMs: parseRetryAfter(retryAfter, now) };
  }
  if (status >= 500 && status <= 599) return { kind: 'server_error', rung };
  const code = Number.isInteger(status) && status >= 100 && status <= 999 ? status : 0;
  return { kind: 'network_error', rung, code: code === 0 ? 'HTTP_STATUS' : `HTTP_${code}` };
}
