// Reading the asked side and a listing into the parts the rules compare. No rule decides here.
import { compactKey } from './codes.ts';
import { brandFieldMatches } from './identifiers.ts';
import { prepare, type Token, tokenForms, tokenise } from './text.ts';
import type { MatchAsked, MatchListing } from './types.ts';
import {
  COLOURS,
  FILLER,
  GENERIC,
  INCLUSION_RE,
  MATERIAL_LINES,
  MATERIALS,
  PART_ANYWHERE_RE,
  PART_NOUN_RE,
  QUALIFIERS,
  RELATION_RE,
  SIZE_ADJECTIVES,
  PART_TRAILER as TRAILER_OK,
} from './vocabulary.ts';

/** A designator of the asked model and the word it hangs on ("pro 2", "pi 5", "master 3s"). */
export interface Designator {
  readonly key: string;
  readonly kind: 'code' | 'number';
  /** The asked name word right before it ("hd" of "HD 600", "pro" of "Pro 2"), if any. */
  readonly anchor: string | null;
  /**
   * A short designator ("2", "a1", "3s") counts only next to its anchor: "Pro 2" is a model, a
   * bare "2" is not. A long one ("4100", "dcd793d1") stands alone; its anchor only matters when
   * another word takes its place ("IE 600" for "HD 600").
   */
  readonly needsAnchor: boolean;
}

export interface AskedView {
  readonly prepared: string;
  readonly tokens: readonly Token[];
  /** Brand words (from `brand`, else the name's first name word). */
  readonly brand: readonly string[];
  /** True when the brand came from the field, not guessed from the name. */
  readonly brandKnown: boolean;
  readonly brandText: string;
  readonly designators: readonly Designator[];
  /** Thousand-counts in the name ("PowerCore 24K", "Saturn 4 Ultra 16K"): part of the model's name. */
  readonly kMeasures: readonly Token[];
  /** Alphanumeric codes of the asked model (from the name and `model`). */
  readonly codes: readonly string[];
  /** Name words that must appear for a listing without designators to be confirmed. */
  readonly lineWords: readonly string[];
  readonly qualifiers: ReadonlySet<string>;
  /** Words written with a plus mark ("pla+", "pro+"). */
  readonly plusWords: ReadonlySet<string>;
  readonly materials: ReadonlySet<string>;
  readonly combo: boolean;
  /** Every token key of the asked name (and brand, model), for "is this word asked?". */
  readonly words: ReadonlySet<string>;
  /** True when the asked thing is itself a part or accessory ("travel case for ..."). */
  readonly isPart: boolean;
  /** The part noun the asked name ends in, which never marks a listing as a part. */
  readonly headPart: string | null;
}

export interface Clause {
  /** The clause's name region: before any relation or inclusion marker. */
  readonly name: readonly Token[];
  readonly nameText: string;
  /** After a relation marker ("for ..."), up to the next marker. */
  readonly tail: readonly Token[];
  /** After an inclusion marker ("with ...", "+ ..."). */
  readonly incl: readonly Token[];
  /** The whole clause text (prepared). */
  readonly text: string;
}

export interface ListingView {
  readonly prepared: string;
  readonly clauses: readonly Clause[];
  /** Name tokens of every clause, in order. */
  readonly name: readonly Token[];
  /** Name and inclusion tokens, in order: where the listing's own words are. */
  readonly own: readonly Token[];
  /** The own tokens by region (each clause's name, each clause's inclusions): adjacency holds within one. */
  readonly segments: readonly (readonly Token[])[];
  readonly tail: readonly Token[];
  /** Prepared text of the variant options (values, and keys that carry a value's name). */
  readonly variantText: string;
  readonly variantTokens: readonly Token[];
  /** Forms of every own token, for presence checks. */
  readonly ownForms: ReadonlySet<string>;
  readonly brandField: string | null;
}

const isNameWord = (t: Token): boolean =>
  t.kind === 'word' && !FILLER.has(t.key) && !GENERIC.has(t.key) && t.key.length > 1;

/** Reads the asked side. */
export function analyseAsked(asked: MatchAsked): AskedView {
  const name = asked.name;
  const extra = [asked.model].filter((s): s is string => typeof s === 'string' && s !== '');
  const prepared = prepare(name);
  const tokens = tokenise(prepared);
  const extraTokens = extra.flatMap((e) => tokenise(prepare(e)));
  const brandTokens =
    typeof asked.brand === 'string' && asked.brand.trim() !== ''
      ? tokenise(prepare(asked.brand)).filter((t) => t.kind !== 'measure')
      : [];
  const firstName = tokens.find((t) => t.kind === 'word' && !FILLER.has(t.key));
  const brand =
    brandTokens.length > 0 ? brandTokens.map((t) => t.key) : firstName ? [firstName.key] : [];
  const brandSet = new Set(brand);
  const all = [...tokens, ...extraTokens];
  const mpnTokens =
    typeof asked.mpn === 'string' && asked.mpn !== '' ? tokenise(prepare(asked.mpn)) : [];
  const words = new Set<string>();
  for (const t of [...all, ...brandTokens, ...mpnTokens]) {
    for (const f of tokenForms(t)) words.add(f);
  }

  const codes = [...new Set(all.filter((t) => t.kind === 'code').map((t) => t.key))];
  const designators: Designator[] = [];
  const seen = new Set<string>();
  for (const list of [tokens, extraTokens]) {
    list.forEach((t, i) => {
      if (seen.has(t.key)) return;
      const prev = list[i - 1];
      const anchor =
        prev !== undefined &&
        prev.kind === 'word' &&
        !GENERIC.has(prev.key) &&
        !FILLER.has(prev.key) &&
        !brandSet.has(prev.key)
          ? prev.key
          : null;
      if (t.kind === 'code') {
        seen.add(t.key);
        designators.push({ key: t.key, kind: 'code', anchor, needsAnchor: t.key.length <= 3 });
      } else if (t.kind === 'number' && /^\d+$/.test(t.key)) {
        const long = t.key.length >= 3;
        const pairAnchor = anchor ?? (prev?.kind === 'word' ? prev.key : null);
        if (!long && pairAnchor === null) return;
        seen.add(t.key);
        designators.push({
          key: t.key,
          kind: 'number',
          anchor: long ? anchor : pairAnchor,
          needsAnchor: !long,
        });
      }
    });
  }
  const kMeasures = tokens.filter((t) => t.measure?.dim === 'k');

  const qualifiers = new Set(
    all.filter((t) => t.kind === 'word' && QUALIFIERS.has(t.key)).map((t) => t.key),
  );
  const plusWords = new Set(all.filter((t) => t.plus).map((t) => t.key));
  const materials = new Set(all.filter((t) => MATERIALS.has(t.key)).map((t) => t.key));
  const lineWords = [
    ...new Set(
      tokens
        .filter(
          (t) =>
            isNameWord(t) &&
            !brandSet.has(t.key) &&
            !QUALIFIERS.has(t.key) &&
            !COLOURS.has(t.key) &&
            !SIZE_ADJECTIVES.has(t.key) &&
            !MATERIAL_LINES.has(t.key) &&
            !MATERIALS.has(t.key) &&
            t.key !== 'combo',
        )
        .map((t) => t.key),
    ),
  ];
  const relation = RELATION_RE.test(prepared);
  const firstClause = cutClause(prepared.split(CLAUSE_RE)[0] ?? prepared).nameText;
  const headPart = endingPart(firstClause, new Set());
  return {
    prepared,
    tokens,
    brand,
    brandKnown: brandTokens.length > 0,
    brandText: asked.brand ?? brand.join(' '),
    designators,
    kMeasures,
    codes,
    lineWords,
    qualifiers,
    plusWords,
    materials,
    combo: all.some((t) => t.key === 'combo'),
    words,
    isPart: relation || headPart !== null || PART_ANYWHERE_RE.test(prepared),
    headPart,
  };
}

/** Clause separators: punctuation, brackets, " / ", and a dash with spaces around it. */
const CLAUSE_RE = /[,;:|()·•!?]|\s\/\s|\s\.\s/;

function cutClause(text: string): Clause {
  const rel = RELATION_RE.exec(text);
  const inc = INCLUSION_RE.exec(text);
  const relAt = rel ? rel.index : Number.POSITIVE_INFINITY;
  const incAt = inc ? inc.index : Number.POSITIVE_INFINITY;
  const cut = Math.min(relAt, incAt);
  const nameText = Number.isFinite(cut) ? text.slice(0, cut) : text;
  let tailText = '';
  let inclText = '';
  if (rel && relAt <= incAt) {
    const rest = text.slice(relAt + rel[0].length);
    const next = INCLUSION_RE.exec(rest);
    tailText = next ? rest.slice(0, next.index) : rest;
    inclText = next ? rest.slice(next.index + next[0].length) : '';
  } else if (inc) {
    const rest = text.slice(incAt + inc[0].length);
    const next = RELATION_RE.exec(rest);
    inclText = next ? rest.slice(0, next.index) : rest;
    tailText = next ? rest.slice(next.index + next[0].length) : '';
  }
  return {
    name: tokenise(nameText),
    nameText: nameText.trim(),
    tail: tokenise(tailText),
    incl: tokenise(inclText),
    text: text.trim(),
  };
}

/** Reads a listing's title and variant options. */
export function analyseListing(listing: MatchListing): ListingView {
  const prepared = prepare(listing.title);
  const clauses = prepared
    .split(CLAUSE_RE)
    .map((c) => c.trim())
    .filter((c) => c !== '')
    .map(cutClause);
  const segments = clauses.flatMap((c) => [c.name, c.incl]).filter((s) => s.length > 0);
  const variantText = prepare(
    Object.entries(listing.variant)
      .map(([k, v]) => `${k} ${v}`)
      .join(' | '),
  );
  return withSegments(
    {
      prepared,
      clauses,
      name: clauses.flatMap((c) => c.name),
      own: [],
      segments: [],
      tail: clauses.flatMap((c) => c.tail),
      variantText,
      variantTokens: tokenise(variantText),
      ownForms: new Set(),
      brandField: listing.brand,
    },
    segments,
  );
}

function withSegments(l: ListingView, segments: readonly (readonly Token[])[]): ListingView {
  const ownForms = new Set<string>();
  for (const seg of segments) {
    for (const t of seg) for (const f of tokenForms(t)) ownForms.add(f);
    // Adjacent words joined: "protective clean" is "protectiveclean", "k mini" is "kmini".
    for (let i = 0; i + 1 < seg.length; i++) {
      ownForms.add((seg[i]?.key ?? '') + (seg[i + 1]?.key ?? ''));
      if (i + 2 < seg.length) {
        ownForms.add((seg[i]?.key ?? '') + (seg[i + 1]?.key ?? '') + (seg[i + 2]?.key ?? ''));
      }
    }
  }
  return { ...l, own: segments.flat(), segments, ownForms };
}

/**
 * For an asked thing that is itself an accessory ("travel case for logitech mx master 3s"), what
 * the listing says it fits is part of its identity: the "for" tails count as its own words.
 */
export function withTails(l: ListingView): ListingView {
  const tails = l.clauses.map((c) => c.tail).filter((s) => s.length > 0);
  return withSegments(l, [...l.segments, ...tails]);
}

/** The part noun a name segment ends in, if its head noun names a part. */
export function endingPart(segment: string, allowed: ReadonlySet<string>): string | null {
  const text = segment.replace(/\bby\b.*$/, '').trim();
  let last: RegExpExecArray | null = null;
  const re = new RegExp(PART_NOUN_RE.source, 'g');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) last = m;
  if (last === null) return null;
  const trailer = tokenise(text.slice(last.index + last[0].length));
  const ok = trailer.every(
    (t) =>
      t.kind !== 'word' ||
      TRAILER_OK.has(t.key) ||
      allowed.has(t.key) ||
      GENERIC.has(t.key) ||
      COLOURS.has(t.key),
  );
  return ok ? compactKey(last[0]).replace(/s$/, '') : null;
}

/** True when the brand's words appear in the tokens (joined forms count: "bambulab"). */
export function brandInTokens(brand: readonly string[], forms: ReadonlySet<string>): boolean {
  if (brand.length === 0) return false;
  if (brand.every((b) => forms.has(b))) return true;
  return forms.has(brand.join(''));
}

/** Whether the listing confirms the asked brand: in its own words or in its brand field. */
export function brandConfirmed(a: AskedView, l: ListingView): boolean {
  return brandInTokens(a.brand, l.ownForms) || brandFieldMatches(a.brandText, l.brandField);
}
