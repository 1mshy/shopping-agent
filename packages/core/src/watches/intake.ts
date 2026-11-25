// Save-first watch intake (S§2.9, S§5.8 Intake): a pure decision over what the user typed, the
// rules they gave and the watches already saved: what to save, before any retailer is contacted.
// The corpus area `watch-intake` is its definition (evals/corpus/areas/watch-intake/contract.ts);
// the regional storefront rewrite is the caller's next step (regionalListingUrl), not part of it.
import type { Id, Money, WatchKind } from '@agentic-dasher/shared';

export interface IntakeRules {
  readonly targetPrice: Money | null;
  /** Basis points; 500 = 5%. */
  readonly dropBasisPoints: number | null;
  readonly restock: boolean;
  /** Null: the default (12 h = 43200 s). */
  readonly cooldownSeconds: number | null;
}

export interface IntakeExisting {
  readonly watchId: Id;
  readonly key: string;
  /** False: paused. Archived watches are not passed: their keys are free again. */
  readonly active: boolean;
}

export interface IntakeInput {
  readonly input: string;
  readonly rules: IntakeRules;
  readonly existing: readonly IntakeExisting[];
}

export const INTAKE_REFUSALS = [
  'not_one_link_or_name',
  'not_an_http_link',
  'target_not_positive',
  'drop_out_of_range',
  'cooldown_too_short',
] as const;
export type IntakeRefusal = (typeof INTAKE_REFUSALS)[number];

export interface SavedRules {
  readonly targetPrice: Money | null;
  readonly dropBasisPoints: number | null;
  readonly restock: boolean;
  readonly cooldownSeconds: number;
}

export type IntakeDecision =
  | {
      readonly ok: true;
      readonly action: 'create';
      readonly kind: Extract<WatchKind, 'product' | 'query'>;
      readonly normalised: string;
      readonly key: string;
      readonly rules: SavedRules;
      readonly saved: {
        readonly currency: null;
        readonly referencePrice: null;
        readonly lookup: 'queued';
      };
    }
  | {
      readonly ok: true;
      readonly action: 'existing';
      readonly watchId: Id;
      readonly key: string;
      readonly status: 'active' | 'paused';
    }
  | { readonly ok: false; readonly refusal: IntakeRefusal };

/** The default cooldown (S§5.8: 12 h). */
export const DEFAULT_COOLDOWN_SECONDS = 43_200;
/** The shortest cooldown accepted. */
export const MIN_COOLDOWN_SECONDS = 3_600;
/** The default rule when none is given (S§5.8: a 5% drop). */
export const DEFAULT_DROP_BASIS_POINTS = 500;
/** The longest input accepted, in characters (code points). */
export const MAX_INPUT_CHARACTERS = 1_000;

const TRACKING_NAMES = new Set(['fbclid', 'gclid', 'ref', 'ref_', 'tag']);
// A bare `host.tld/…` (predecessor `_watch_input`): gets https://.
const BARE_LINK = /^(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:[/?:#]|$)/;

/** Python's quote_plus: only letters, digits and `_.-~` stay as they are; a space is `+`. */
function quotePlus(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_NAMES.has(lower);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type NormalisedInput =
  | {
      readonly ok: true;
      readonly kind: 'product' | 'query';
      readonly value: string;
      readonly key: string;
    }
  | { readonly ok: false; readonly refusal: 'not_one_link_or_name' | 'not_an_http_link' };

/**
 * What the user typed, normalised: a link keeps its variant parameters and loses its tracking ones
 * (utm_*, fbclid, gclid, ref, ref_, tag in any case), its fragment and its login details (refused);
 * scheme and host are lower-cased, the kept parameters sorted. A name has its whitespace collapsed
 * and a case-folded key.
 */
export function normaliseWatchInput(raw: string): NormalisedInput {
  if (typeof raw !== 'string') return { ok: false, refusal: 'not_one_link_or_name' };
  let value = raw.trim();
  if (
    value === '' ||
    [...value].length > MAX_INPUT_CHARACTERS ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return { ok: false, refusal: 'not_one_link_or_name' };
  }
  if (BARE_LINK.test(value)) value = `https://${value}`;
  if (value.includes('://')) {
    const url = URL.parse(value);
    if (
      url === null ||
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return { ok: false, refusal: 'not_an_http_link' };
    }
    const params = [...new URLSearchParams(url.search)]
      .filter(([name]) => !isTracking(name))
      .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
    const query = params.map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join('&');
    const link = `${url.protocol}//${url.host.toLowerCase()}${url.pathname || '/'}${query ? `?${query}` : ''}`;
    return { ok: true, kind: 'product', value: link, key: `url:${link}` };
  }
  const name = value.split(/\s+/u).filter(Boolean).join(' ');
  return { ok: true, kind: 'query', value: name, key: `query:${name.toLowerCase()}` };
}

export type RulesCheck =
  | { readonly ok: true; readonly rules: SavedRules }
  | {
      readonly ok: false;
      readonly refusal: 'target_not_positive' | 'drop_out_of_range' | 'cooldown_too_short';
    };

/** The rules' validation and defaults, shared by intake and a later rules change. */
export function checkWatchRules(rules: IntakeRules): RulesCheck {
  const { targetPrice, dropBasisPoints, restock, cooldownSeconds } = rules;
  if (
    targetPrice !== null &&
    (!Number.isSafeInteger(targetPrice.amountMinor) || targetPrice.amountMinor <= 0)
  ) {
    return { ok: false, refusal: 'target_not_positive' };
  }
  if (
    dropBasisPoints !== null &&
    (!Number.isSafeInteger(dropBasisPoints) || dropBasisPoints <= 0 || dropBasisPoints >= 10_000)
  ) {
    return { ok: false, refusal: 'drop_out_of_range' };
  }
  if (
    cooldownSeconds !== null &&
    (!Number.isSafeInteger(cooldownSeconds) || cooldownSeconds < MIN_COOLDOWN_SECONDS)
  ) {
    return { ok: false, refusal: 'cooldown_too_short' };
  }
  const nothing = targetPrice === null && dropBasisPoints === null && !restock;
  return {
    ok: true,
    rules: {
      targetPrice,
      dropBasisPoints: nothing ? DEFAULT_DROP_BASIS_POINTS : dropBasisPoints,
      restock,
      cooldownSeconds: cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    },
  };
}

/** The intake decision (corpus area `watch-intake`). */
export function intakeWatch(input: IntakeInput): IntakeDecision {
  const normalised = normaliseWatchInput(input.input);
  if (!normalised.ok) return normalised;
  const checked = checkWatchRules(input.rules);
  if (!checked.ok) return checked;
  const same = input.existing.find((w) => w.key === normalised.key);
  if (same !== undefined) {
    return {
      ok: true,
      action: 'existing',
      watchId: same.watchId,
      key: same.key,
      status: same.active ? 'active' : 'paused',
    };
  }
  return {
    ok: true,
    action: 'create',
    kind: normalised.kind,
    normalised: normalised.value,
    key: normalised.key,
    rules: checked.rules,
    saved: { currency: null, referencePrice: null, lookup: 'queued' },
  };
}
