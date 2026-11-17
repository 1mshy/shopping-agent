// SYNTHETIC test inputs. Every product, snapshot and label built here is invented for the tests
// (brands are "Synthetic Brand N", hosts end in `.example`). None of it is gold data, and no number
// computed from it is a measurement of anything.
import type { MatchRelation } from '@agentic-dasher/shared';
import type { GoldProduct, GoldSet, ListingSnapshot, RelationLabel } from '../lib/formats.ts';

export interface SyntheticOptions {
  products?: number;
  categories?: number;
  countries?: readonly string[];
  snapshotsPerProduct?: number;
  /** Relations given to a product's snapshots in turn (primary labels). */
  relationCycle?: readonly MatchRelation[];
  labelled?: boolean;
}

/** Hard negatives under the recommended definition: 6 of 10 here, 60%. */
export const DEFAULT_CYCLE: readonly MatchRelation[] = [
  'exact',
  'exact',
  'exact',
  'variant',
  'bundle',
  'accessory_or_part',
  'other_model',
  'other_line',
  'variant',
  'other_model',
];

export function syntheticProduct(i: number, category: string, country: string): GoldProduct {
  return {
    id: `syn-p${String(i).padStart(3, '0')}`,
    category,
    country,
    identity: {
      brand: `Synthetic Brand ${i}`,
      model: `SX-${i}`,
      mpn: `SYN-${i}-MPN`,
      mustHave: { capacity: '1 unit' },
      condition: 'new',
      packQuantity: 1,
    },
    notes: 'synthetic test input',
  };
}

export function syntheticSnapshot(product: GoldProduct, j: number): ListingSnapshot {
  return {
    id: `${product.id}-s${String(j).padStart(2, '0')}`,
    productId: product.id,
    capture: {
      url: `https://store${j}.example/p/${product.id}`,
      country: product.country,
      capturedAt: '2026-11-01T00:00:00Z',
    },
    listing: {
      title: `${product.identity.brand} listing ${j}`,
      brand: product.identity.brand,
      variantAttributes: {},
      condition: 'new',
      sellerKind: 'first_party',
      storeHost: `store${j}.example`,
    },
    context: { priceText: '$1.00', currency: 'USD' },
  };
}

export function syntheticLabel(
  snapshotId: string,
  relation: MatchRelation,
  labellerId = 'syn-a',
  pass: RelationLabel['pass'] = 'primary',
): RelationLabel {
  return { snapshotId, relation, labellerId, labelledAt: '2026-11-02T00:00:00Z', pass };
}

/** A complete synthetic set: 60 products, 6 categories, 3 countries, 15 snapshots each. */
export function syntheticSet(opts: SyntheticOptions = {}): GoldSet {
  const n = opts.products ?? 60;
  const categories = opts.categories ?? 6;
  const countries = opts.countries ?? ['CA', 'US', 'DE'];
  const perProduct = opts.snapshotsPerProduct ?? 15;
  const cycle = opts.relationCycle ?? DEFAULT_CYCLE;
  const products: GoldProduct[] = [];
  const snapshots: ListingSnapshot[] = [];
  const labels: RelationLabel[] = [];
  for (let i = 0; i < n; i++) {
    const category = `syn-cat-${i % categories}`;
    const country = countries[Math.floor(i / categories) % countries.length] ?? 'US';
    const p = syntheticProduct(i, category, country);
    products.push(p);
    for (let j = 0; j < perProduct; j++) {
      const s = syntheticSnapshot(p, j);
      snapshots.push(s);
      if (opts.labelled !== false) {
        labels.push(syntheticLabel(s.id, cycle[j % cycle.length] ?? 'unknown'));
      }
    }
  }
  return { products, snapshots, labels };
}
