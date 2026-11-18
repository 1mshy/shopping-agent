// Spike D's dataset: one item per case of the four matcher areas of the fixture corpus, built by
// importing the areas, never by copying them. The asked side, the listing and the expectation are
// the corpus's own objects. What this set is and is not: README "The dataset".
import { createHash } from 'node:crypto';
import { MATCH_RELATIONS } from '@agentic-dasher/shared';
import { area as wrongVariant } from '../corpus/areas/known-failure-wrong-variant/area.ts';
import { area as identifiers } from '../corpus/areas/match-identifiers/area.ts';
import { area as ownerRulings } from '../corpus/areas/match-owner-rulings/area.ts';
import { area as titleRules } from '../corpus/areas/match-title-rules/area.ts';
import type {
  EvidenceKind,
  MatchAsked,
  MatchCase,
  MatchExpected,
  MatchListing,
} from '../corpus/areas/match-title-rules/contract.ts';
import type { Area } from '../corpus/harness.ts';

export const SOURCE_AREAS: readonly Area<MatchCase>[] = [
  titleRules,
  identifiers,
  ownerRulings,
  wrongVariant,
];

/**
 * What kind of wrong product a non-exact item is, from its gold relation where that is single.
 * `variant` is split only where the case itself says which attribute differs (VARIANT_SPLIT);
 * a single `unknown` gold means the listing gives no positive evidence either way.
 */
export const ERROR_CLASSES = [
  'other_line',
  'other_model',
  'variant:capacity',
  'variant:configuration',
  'variant:unspecified',
  'bundle',
  'accessory_or_part',
  'no_positive_evidence',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** A reporting bucket: an error class, or `set` for the items whose gold is a set. */
export type ClassBucket = ErrorClass | 'set';
export const CLASS_BUCKETS: readonly ClassBucket[] = [...ERROR_CLASSES, 'set'];

/**
 * The single-`variant` cases whose own text says which attribute differs, with the words quoted
 * from the case's `what` or `label` (a test checks the quote is there). Every other single
 * `variant` case is `variant:unspecified`.
 */
export const VARIANT_SPLIT: Readonly<
  Record<string, { subclass: 'capacity' | 'configuration'; quote: string }>
> = {
  'match-title-rules/for-business-edition-with-part-number': {
    subclass: 'configuration',
    quote: 'variants in configuration',
  },
  'match-title-rules/for-business-ranked-over-an-accessory': {
    subclass: 'configuration',
    quote: 'variants in configuration',
  },
  'match-owner-rulings/combo-asked-listing-without-the-ams': {
    subclass: 'configuration',
    quote: 'another configuration',
  },
  'match-owner-rulings/variant-counted-by-the-hand-check': {
    subclass: 'configuration',
    quote: 'variants in configuration',
  },
  'known-failure-wrong-variant/printer-without-the-ams-for-the-combo': {
    subclass: 'configuration',
    quote: 'another configuration',
  },
  'known-failure-wrong-variant/six-cup-for-ten-cup': {
    subclass: 'capacity',
    quote: 'a capacity difference',
  },
};

export interface JudgeItem {
  /** `<area id>/<case id>`, unique. */
  readonly key: string;
  readonly area: string;
  readonly caseId: string;
  readonly asked: MatchAsked;
  readonly listing: MatchListing;
  /** The corpus expectation: one relation, or a set that never holds `exact`. */
  readonly gold: MatchExpected;
  /** Null for an exact gold and for a set. */
  readonly errorClass: ErrorClass | null;
  /** The distinct kinds of evidence the case cites, in a fixed order. */
  readonly evidenceKinds: readonly EvidenceKind[];
  /** Listing fields the judge is not shown (S§5.7: titles and attributes only). */
  readonly withheld: readonly 'url'[];
}

const EVIDENCE_ORDER: readonly EvidenceKind[] = ['test', 'review', 'report', 'code', 'run', 'spec'];

export function errorClassOf(areaId: string, c: MatchCase): ErrorClass | null {
  if (!('relation' in c.expected)) return null;
  const r = c.expected.relation;
  switch (r) {
    case 'exact':
      return null;
    case 'variant': {
      const split = VARIANT_SPLIT[`${areaId}/${c.id}`];
      return split ? `variant:${split.subclass}` : 'variant:unspecified';
    }
    case 'unknown':
      return 'no_positive_evidence';
    default:
      return r;
  }
}

export function buildDataset(areas: readonly Area<MatchCase>[] = SOURCE_AREAS): JudgeItem[] {
  return areas.flatMap((a) =>
    a.cases.map((c) => {
      const kinds = new Set(c.from.map((e) => e.kind));
      return {
        key: `${a.id}/${c.id}`,
        area: a.id,
        caseId: c.id,
        asked: c.input.asked,
        listing: c.input.listing,
        gold: c.expected,
        errorClass: errorClassOf(a.id, c),
        evidenceKinds: EVIDENCE_ORDER.filter((k) => kinds.has(k)),
        withheld: c.input.listing.url === null ? [] : ['url' as const],
      };
    }),
  );
}

export const DATASET: readonly JudgeItem[] = buildDataset();

/** sha256 over the keys, asked sides, listings and golds. Result files carry it. */
export function datasetFingerprint(items: readonly JudgeItem[]): string {
  const canon = items.map((i) => [i.key, i.asked, i.listing, i.gold]);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

export interface Composition {
  readonly total: number;
  readonly single: number;
  readonly set: number;
  /** Single golds by relation, plus `set`. */
  readonly byRelation: Readonly<Record<string, number>>;
  readonly byArea: Readonly<Record<string, { single: number; set: number; total: number }>>;
  /** Items citing each kind; an item counts under every kind it cites. */
  readonly byEvidence: Readonly<Record<EvidenceKind, number>>;
  readonly byErrorClass: Readonly<Record<ErrorClass, number>>;
  readonly urlWithheld: number;
  readonly urlWithheldExact: number;
}

export function composition(items: readonly JudgeItem[]): Composition {
  const byRelation: Record<string, number> = {};
  for (const r of MATCH_RELATIONS) byRelation[r] = 0;
  byRelation.set = 0;
  const byArea: Record<string, { single: number; set: number; total: number }> = {};
  const byEvidence = Object.fromEntries(EVIDENCE_ORDER.map((k) => [k, 0])) as Record<
    EvidenceKind,
    number
  >;
  const byErrorClass = Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0])) as Record<
    ErrorClass,
    number
  >;
  let single = 0;
  let urlWithheld = 0;
  let urlWithheldExact = 0;
  for (const i of items) {
    const isSingle = 'relation' in i.gold;
    const label = 'relation' in i.gold ? i.gold.relation : 'set';
    byRelation[label] = (byRelation[label] ?? 0) + 1;
    if (isSingle) single++;
    const a = byArea[i.area] ?? { single: 0, set: 0, total: 0 };
    byArea[i.area] = {
      single: a.single + (isSingle ? 1 : 0),
      set: a.set + (isSingle ? 0 : 1),
      total: a.total + 1,
    };
    for (const k of i.evidenceKinds) byEvidence[k]++;
    if (i.errorClass) byErrorClass[i.errorClass]++;
    if (i.withheld.includes('url')) {
      urlWithheld++;
      if (label === 'exact') urlWithheldExact++;
    }
  }
  return {
    total: items.length,
    single,
    set: items.length - single,
    byRelation,
    byArea,
    byEvidence,
    byErrorClass,
    urlWithheld,
    urlWithheldExact,
  };
}

/** The composition tables as the README shows them (a test keeps the two equal). */
export function compositionMarkdown(items: readonly JudgeItem[]): string {
  const c = composition(items);
  const lines: string[] = [];
  lines.push('| Gold label | Items |', '|---|--:|');
  for (const r of MATCH_RELATIONS) lines.push(`| \`${r}\` | ${c.byRelation[r] ?? 0} |`);
  lines.push(`| a set of relations (no single label, never \`exact\`) | ${c.set} |`);
  lines.push(`| **Total** | **${c.total}** (${c.single} single, ${c.set} sets) |`, '');
  lines.push('| Corpus area | Single label | Set | Total |', '|---|--:|--:|--:|');
  for (const [area, n] of Object.entries(c.byArea)) {
    lines.push(`| ${area} | ${n.single} | ${n.set} | ${n.total} |`);
  }
  lines.push('');
  lines.push(
    '| Evidence kind cited (an item counts under each kind it cites) | Items |',
    '|---|--:|',
  );
  for (const [k, n] of Object.entries(c.byEvidence)) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  lines.push('| Error class (single non-exact labels only) | Items |', '|---|--:|');
  for (const [k, n] of Object.entries(c.byErrorClass)) lines.push(`| \`${k}\` | ${n} |`);
  lines.push('');
  lines.push(
    `Listings with a URL, which the judge is not shown (S§5.7): ${c.urlWithheld}, of which ` +
      `${c.urlWithheldExact} have an \`exact\` gold.`,
  );
  return lines.join('\n');
}
