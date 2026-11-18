// Evidence kept with each result: the classifier's whole input, so a stored result can be
// re-classified offline without another request (reclassify.ts).
import {
  bodyMarkers,
  type HttpResponse,
  type Observed,
  observe,
  platformSignalsObserved,
} from './classify.ts';
import type { Evidence, Platform, Validation } from './outcome.ts';

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

/**
 * The classifier input back from stored evidence; undefined if the request got no answer. Body
 * markers are the stored ones plus any a newer marker rule finds in the stored snippet (the
 * body's first 300 characters), so a marker added later can be applied offline where it shows
 * in that prefix.
 */
export function observedFrom(e: Evidence): Observed | undefined {
  if (e.status === undefined || e.finalUrl === undefined || e.headers === undefined) {
    return undefined;
  }
  const fromSnippet = bodyMarkers(
    e.contentType ?? e.headers['content-type'] ?? '',
    e.snippet ?? '',
  );
  return {
    status: e.status,
    finalUrl: e.finalUrl,
    headers: e.headers,
    bytes: e.bytes ?? 0,
    ...(e.title ? { title: e.title } : {}),
    markers: [...new Set([...(e.markers ?? []), ...fromSnippet])],
  };
}

/** Platforms shown by the host's robots.txt answer, for the host-level 404 rule. */
export function hostPlatforms(robots: Evidence | undefined): Array<Exclude<Platform, 'any'>> {
  const o = robots ? observedFrom(robots) : undefined;
  return o ? platformSignalsObserved(o) : [];
}

/** The validator verdict back from stored evidence. */
export function validationFrom(e: Evidence): Validation | undefined {
  if (e.valid === undefined) return undefined;
  return e.valid
    ? { valid: true, items: e.items ?? 0 }
    : { valid: false, reason: e.validation ?? '' };
}
