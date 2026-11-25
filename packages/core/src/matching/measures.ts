// Comparing the quantities two texts state (capacity, weight, storage, charge, power). Quantities
// in two unit systems ("10 cup" against "2.4 L") are not compared: the rules leave such a listing
// to the judge rather than convert a marketing figure.
import type { Token } from './text.ts';

export type MeasureVerdict =
  | { readonly kind: 'none' }
  | { readonly kind: 'match' }
  | { readonly kind: 'conflict'; readonly dim: string; readonly attribute: string }
  | { readonly kind: 'incomparable'; readonly dim: string };

/** The other unit system of a dimension, when there is one. */
const OTHER_SYSTEM: Readonly<Record<string, string>> = {
  vol: 'vol_us',
  vol_us: 'vol',
  mass: 'mass_us',
  mass_us: 'mass',
};

const ATTRIBUTE: Readonly<Record<string, string>> = {
  mass: 'weight',
  mass_us: 'weight',
  vol: 'capacity',
  vol_us: 'capacity',
  storage: 'capacity',
  charge: 'capacity',
  power: 'power',
  k: 'model',
};

function byDim(tokens: readonly Token[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const t of tokens) {
    if (t.measure === undefined) continue;
    out.set(t.measure.dim, [...(out.get(t.measure.dim) ?? []), t.measure.value]);
  }
  return out;
}

/**
 * The asked quantities against the listing's. A dimension the listing does not state is no
 * conflict (a missing attribute is not a conflict, S§5.4). A thousand-count ("24K") also matches
 * a charge of that value ("24000mAh").
 */
export function compareMeasures(
  asked: readonly Token[],
  listing: readonly Token[],
): MeasureVerdict {
  const a = byDim(asked);
  const l = byDim(listing);
  let result: MeasureVerdict = { kind: 'none' };
  for (const [dim, values] of a) {
    const attribute = ATTRIBUTE[dim];
    if (attribute === undefined) continue;
    const listed = [...(l.get(dim) ?? []), ...(dim === 'k' ? (l.get('charge') ?? []) : [])];
    if (listed.length > 0) {
      if (values.some((v) => listed.includes(v))) {
        if (result.kind === 'none') result = { kind: 'match' };
        continue;
      }
      const sameDim = l.get(dim) ?? [];
      if (sameDim.length > 0) return { kind: 'conflict', dim, attribute };
      continue;
    }
    const other = OTHER_SYSTEM[dim];
    if (other !== undefined && (l.get(other) ?? []).length > 0) {
      result = { kind: 'incomparable', dim };
    }
  }
  return result;
}
