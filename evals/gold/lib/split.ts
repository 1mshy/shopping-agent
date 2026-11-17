// The dev/held-out split (S§5.16, plan P0 workstream 4, P7 workstream 6). The manifest is the
// source of truth: a product, once assigned, never moves. A run assigns only products the
// manifest does not list yet, stratified by category and country, deterministically from the
// manifest's seed. Rotation retires products in place; the next run fills the freed places.
import {
  GOLD_TOOL_VERSION,
  type GoldProduct,
  identityKeys,
  type SplitManifest,
  type SplitSide,
} from './formats.ts';
import { SPLIT_TARGETS } from './requirements.ts';
import { seededRandom, shuffled } from './seeded.ts';

export class SplitRefusal extends Error {
  override name = 'SplitRefusal';
}

type Assignment = SplitManifest['assignments'][number];

export interface SplitResult {
  manifest: SplitManifest;
  assigned: { productId: string; side: SplitSide }[];
  /** New products placed on a side because the same real-world product is already there. */
  forced: { productId: string; side: SplitSide; sameAs: string[] }[];
}

const stratumOf = (p: GoldProduct) => `${p.category}|${p.country}`;
const nextRun = (m?: SplitManifest) =>
  1 + Math.max(0, ...(m?.assignments ?? []).flatMap((a) => [a.run, a.retired?.run ?? 0]));

/** Groups of product ids that share a GTIN or a normalised brand + MPN (union-find). */
export function identityGroups(products: readonly GoldProduct[]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const owner = new Map<string, string>();
  for (const p of [...products].sort((a, b) => a.id.localeCompare(b.id))) {
    parent.set(p.id, find(p.id));
    for (const key of identityKeys(p)) {
      const other = owner.get(key);
      if (other === undefined) owner.set(key, p.id);
      else parent.set(find(p.id), find(other));
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()];
}

/** One message per real-world product that has members on both sides (retired ones included). */
export function findLeakage(products: readonly GoldProduct[], manifest: SplitManifest): string[] {
  const side = new Map(manifest.assignments.map((a) => [a.productId, a.side]));
  const out: string[] = [];
  for (const group of identityGroups(products)) {
    const dev = group.filter((id) => side.get(id) === 'dev');
    const held = group.filter((id) => side.get(id) === 'held_out');
    if (dev.length > 0 && held.length > 0) {
      out.push(`same product on both sides of the split (leak): dev ${dev} / held_out ${held}`);
    }
  }
  return out;
}

export function assignSplit(
  products: readonly GoldProduct[],
  manifest: SplitManifest | undefined,
  seed: string,
): SplitResult {
  if (manifest && manifest.seed !== seed) {
    throw new SplitRefusal(`the manifest was made with seed "${manifest.seed}", not "${seed}"`);
  }
  if (manifest) {
    const leaks = findLeakage(products, manifest);
    if (leaks.length > 0) throw new SplitRefusal(leaks.join('\n'));
  }
  const run = nextRun(manifest);
  const byId = new Map(products.map((p) => [p.id, p]));
  const sideOf = new Map((manifest?.assignments ?? []).map((a) => [a.productId, a.side]));
  const added: Assignment[] = [];
  const forced: SplitResult['forced'] = [];
  const units: { ids: string[]; stratum: string }[] = [];
  for (const group of identityGroups(products)) {
    const fresh = group.filter((id) => !sideOf.has(id)).sort();
    if (fresh.length === 0) continue;
    const placed = group.filter((id) => sideOf.has(id)).sort();
    const side = placed.map((id) => sideOf.get(id))[0];
    if (side) {
      for (const productId of fresh) {
        added.push({ productId, side, run });
        forced.push({ productId, side, sameAs: placed });
      }
    } else {
      const first = byId.get(fresh[0] as string) as GoldProduct;
      units.push({ ids: fresh, stratum: stratumOf(first) });
    }
  }

  // Active (not retired) counts, overall and per stratum, including the forced placements.
  const active = [...(manifest?.assignments ?? []).filter((a) => !a.retired), ...added];
  const count = { dev: 0, held_out: 0 };
  const stratumHeld = new Map<string, number>();
  const stratumTotal = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  for (const a of active) {
    count[a.side]++;
    const p = byId.get(a.productId);
    if (!p) continue;
    bump(stratumTotal, stratumOf(p));
    if (a.side === 'held_out') bump(stratumHeld, stratumOf(p));
  }
  for (const u of units) bump(stratumTotal, u.stratum, u.ids.length);

  // How many new products go to held-out: fill both targets in proportion to their free places,
  // then keep the 40:20 ratio beyond them. After a rotation only held-out has free places.
  const { dev: D, held_out: H } = SPLIT_TARGETS;
  const n = units.reduce((s, u) => s + u.ids.length, 0);
  const hFree = Math.max(0, H - count.held_out);
  const dFree = Math.max(0, D - count.dev);
  const heldNew =
    n <= hFree + dFree
      ? hFree + dFree === 0
        ? 0
        : Math.round((n * hFree) / (hFree + dFree))
      : hFree + Math.round(((n - hFree - dFree) * H) / (H + D));

  // Give held-out places to the strata furthest below their share; ties go by the seeded order.
  const want = (s: string) =>
    ((stratumTotal.get(s) ?? 0) * H) / (H + D) - (stratumHeld.get(s) ?? 0);
  let remaining = shuffled(units, seededRandom(`${seed}:assign:${run}`));
  let held = 0;
  for (;;) {
    let best: (typeof units)[number] | undefined;
    for (const u of remaining) {
      if (held + u.ids.length > heldNew) continue;
      if (!best || want(u.stratum) > want(best.stratum)) best = u;
    }
    if (!best) break;
    const chosen = best;
    held += chosen.ids.length;
    bump(stratumHeld, chosen.stratum, chosen.ids.length);
    for (const productId of chosen.ids) added.push({ productId, side: 'held_out', run });
    remaining = remaining.filter((u) => u !== chosen);
  }
  for (const u of remaining)
    for (const productId of u.ids) added.push({ productId, side: 'dev', run });

  if (added.length === 0 && manifest) return { manifest, assigned: [], forced };
  return {
    manifest: {
      formatVersion: 1,
      seed,
      toolVersion: GOLD_TOOL_VERSION,
      assignments: [...(manifest?.assignments ?? []), ...added].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      ),
    },
    assigned: added.map(({ productId, side }) => ({ productId, side })),
    forced,
  };
}

/** A seeded pick of `count` active held-out products to rotate out (plan P7 workstream 6). */
export function pickRotation(manifest: SplitManifest, count: number): string[] {
  const held = manifest.assignments
    .filter((a) => a.side === 'held_out' && !a.retired)
    .map((a) => a.productId)
    .sort();
  if (!Number.isInteger(count) || count < 1 || count > held.length) {
    throw new SplitRefusal(`cannot rotate ${count}: only ${held.length} active held-out products`);
  }
  return shuffled(held, seededRandom(`${manifest.seed}:rotate:${nextRun(manifest)}`)).slice(
    0,
    count,
  );
}

/** Retire products in place. They keep their side, so they can never reappear on the other. */
export function retire(
  manifest: SplitManifest,
  ids: readonly string[],
  reason: string,
): SplitManifest {
  const run = nextRun(manifest);
  const wanted = new Set(ids);
  for (const id of wanted) {
    const a = manifest.assignments.find((x) => x.productId === id);
    if (!a || a.retired) throw new SplitRefusal(`${id} is not an active assignment`);
  }
  return {
    ...manifest,
    toolVersion: GOLD_TOOL_VERSION,
    assignments: manifest.assignments.map((a) =>
      wanted.has(a.productId) ? { ...a, retired: { run, reason } } : a,
    ),
  };
}
