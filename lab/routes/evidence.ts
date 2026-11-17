// Evidence kept with each result: the classifier's whole input, so a stored result can be
// re-classified offline without another request (reclassify.ts).
import { type HttpResponse, type Observed, observe } from './classify.ts';
import type { Evidence, Validation } from './outcome.ts';

const SNIPPET = 300;

/** Evidence for an answered request: the observed response, the validator verdict, a snippet. */
export function answerEvidence(
  res: HttpResponse,
  v: Validation,
  extra: { signals: string[]; hops: number; ms?: number },
): Evidence {
  const o = observe(res);
  return {
    status: o.status,
    finalUrl: o.finalUrl,
    contentType: o.headers['content-type'] ?? '',
    bytes: o.bytes,
    headers: o.headers,
    markers: o.markers,
    valid: v.valid,
    ...(v.valid ? { items: v.items } : {}),
    validation: v.valid ? (v.note ?? `items=${v.items}`) : v.reason,
    ...(o.title ? { title: o.title } : {}),
    ...(v.valid ? {} : { snippet: res.body.slice(0, SNIPPET).replace(/\s+/g, ' ') }),
    ...extra,
  };
}

/** The classifier input back from stored evidence; undefined if the request got no answer. */
export function observedFrom(e: Evidence): Observed | undefined {
  if (e.status === undefined || e.finalUrl === undefined || e.headers === undefined) {
    return undefined;
  }
  return {
    status: e.status,
    finalUrl: e.finalUrl,
    headers: e.headers,
    bytes: e.bytes ?? 0,
    ...(e.title ? { title: e.title } : {}),
    markers: e.markers ?? [],
  };
}

/** The validator verdict back from stored evidence. */
export function validationFrom(e: Evidence): Validation | undefined {
  if (e.valid === undefined) return undefined;
  return e.valid
    ? { valid: true, items: e.items ?? 0 }
    : { valid: false, reason: e.validation ?? '' };
}
