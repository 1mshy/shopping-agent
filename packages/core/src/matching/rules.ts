// Tier 2 (S§5.4): the title rules. They read the asked name and the listing's title (with its
// variant options, MPN and URL as supporting evidence) and answer with a relation label, never a
// score. The precedence of the labels, when several rules fire, is fixed in `decideRules`.
import type { MatchRelation } from '@agentic-dasher/shared';
import {
  type AskedView,
  analyseAsked,
  analyseListing,
  brandConfirmed,
  brandInTokens,
  type Designator,
  endingPart,
  type ListingView,
  withTails,
} from './analyse.ts';
import {
  codeAgrees,
  codeShape,
  commonPrefix,
  compactKey,
  comparableCodes,
  compareCodes,
  mpnForms,
  mpnParts,
} from './codes.ts';
import { compareMeasures, type MeasureVerdict } from './measures.ts';
import { prepare, type Token, tokenForms, tokenise } from './text.ts';
import type { MatchAsked, MatchListing } from './types.ts';
import {
  BUNDLE_RE,
  COLOURS,
  EDITION_WORDS,
  FILLER,
  GENERIC,
  HEATSINK_RE,
  INCLUSION_RE,
  JOINING_PLUS_RE,
  MATERIAL_LINES,
  MATERIALS,
  NUMBER_WORDS,
  PART_ANYWHERE_RE,
  QUALIFIERS,
  RELATION_RE,
  SIZE_ADJECTIVES,
  WITHOUT_RE,
} from './vocabulary.ts';

/** One rule's finding. */
interface Finding {
  readonly relation: MatchRelation;
  readonly attrs: readonly string[];
  readonly rule: string;
}

export interface TitleVerdict {
  readonly relation: MatchRelation;
  readonly differingAttrs: readonly string[];
  readonly rule: string;
  /** The asked identity is confirmed by the listing's own words (designators or line words). */
  readonly confirmed: boolean;
  readonly brandConfirmed: boolean;
}

const digitBearing = (t: Token | undefined): boolean =>
  t !== undefined &&
  (t.kind === 'code' ||
    (t.kind === 'number' && /^\d+(?:\.\d+)?$/.test(t.key)) ||
    NUMBER_WORDS.has(t.key));

const numberKey = (t: Token): string => NUMBER_WORDS.get(t.key) ?? t.key;

/** Pairs of neighbouring own tokens, within one region of the title (never across clauses). */
function adjacent(l: ListingView): (readonly [Token, Token])[] {
  const out: (readonly [Token, Token])[] = [];
  for (const seg of l.segments) {
    for (let j = 1; j < seg.length; j++) {
      const prev = seg[j - 1];
      const cur = seg[j];
      if (prev !== undefined && cur !== undefined) out.push([prev, cur]);
    }
  }
  return out;
}

// ── accessory and part rejects ────────────────────────────────────────────────────────────────

/** The forms an asked designator can be found under in a token list. */
function designatorIn(d: Designator, tokens: readonly Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    const forms = tokenForms(t);
    if (d.kind === 'code' && forms.some((f) => f === d.key || codeAgrees(compareCodes(d.key, f)))) {
      return true;
    }
    if (d.kind === 'number') {
      if (!d.needsAnchor && forms.includes(d.key)) return true;
      if (d.anchor !== null && forms.includes(d.anchor + d.key)) return true;
      const next = tokens[i + 1];
      if (d.anchor !== null && t.key === d.anchor && next && numberKey(next) === d.key) return true;
      if (!d.needsAnchor && forms.some((f) => f.endsWith(d.key) && /^[a-z]+\d+$/.test(f))) {
        return true;
      }
    }
  }
  return false;
}

/** Asked words (brand, line words, qualifiers) found in a token list. */
function askedWordCount(a: AskedView, tokens: readonly Token[]): number {
  const keys = new Set([...a.brand, ...a.lineWords, ...a.qualifiers]);
  let n = 0;
  const seen = new Set<string>();
  for (const t of tokens) {
    if (keys.has(t.key) && !seen.has(t.key)) {
      n++;
      seen.add(t.key);
    }
  }
  return n;
}

/**
 * Position: the asked identity sits after "for" / "compatible with" and none of it before
 * ("DiamondBack HotEnd for Bambu Lab X1C, X1E, P1P & P1S"). The tail stops at the next marker, so
 * "Base for Air Frying, ... with 4-Quart Basket (AF101)" keeps its AF101 out of it.
 */
function partByPosition(a: AskedView, l: ListingView): boolean {
  if (a.isPart) return false;
  const text = l.prepared;
  const designators = a.designators.filter((d) => designatorIn(d, tokenise(text)));
  const re = new RegExp(RELATION_RE.source, 'g');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const head = tokenise(text.slice(0, m.index));
    const rest = text.slice(m.index + m[0].length);
    const inc = INCLUSION_RE.exec(rest);
    const rel = RELATION_RE.exec(rest);
    const cut = Math.min(inc ? inc.index : rest.length, rel ? rel.index : rest.length);
    const tail = tokenise(rest.slice(0, cut));
    if (designators.length > 0) {
      const inTail = designators.some((d) => designatorIn(d, tail));
      const inHead = designators.some((d) => designatorIn(d, head));
      if (inTail && !inHead) return true;
    } else if (askedWordCount(a, tail) > askedWordCount(a, head)) {
      return true;
    }
  }
  return false;
}

/** Does this clause name the asked product (its brand, a designator, or half its line words)? */
function namesTheProduct(a: AskedView, tokens: readonly Token[]): boolean {
  const forms = new Set(tokens.flatMap(tokenForms));
  for (let i = 0; i + 1 < tokens.length; i++)
    forms.add((tokens[i]?.key ?? '') + (tokens[i + 1]?.key ?? ''));
  if (brandInTokens(a.brand, forms)) return true;
  if (a.designators.some((d) => designatorIn(d, tokens))) return true;
  // A sibling model's code names the family ("K1 Max PEI plate" for a K1C).
  const codes = tokens.filter((t) => t.kind === 'code').map((t) => t.key);
  if (codes.some((c) => a.codes.some((ac) => comparableCodes(ac, c)))) return true;
  const line = a.lineWords.filter((w) => forms.has(w)).length;
  return a.lineWords.length > 0 && line * 2 >= a.lineWords.length;
}

/**
 * Name: a clause that names the product has a part noun as its head ("Elegoo Saturn 4 Ultra Resin
 * Tank", "Bambu Lab - Engineering Plate"), or says accessory, sticker or toolhead anywhere.
 * Clauses that start with a count ("1 Brush Head") list what is in the box and are skipped.
 */
function partByName(a: AskedView, l: ListingView): boolean {
  if (a.isPart) return false;
  // What may follow a part noun and still leave it the head: the model it fits ("Cable - A1 mini").
  const fits = new Set([...a.brand, ...a.qualifiers, ...a.designators.map((d) => d.key)]);
  for (const c of l.clauses) {
    if (PART_ANYWHERE_RE.test(c.nameText)) return true;
    // A clause that opens with a count lists what is in the box ("1 Brush Head", "10-Inch LCD").
    if (/^\d+(?:\.\d+)?[\s-]*(?:x\s*)?(?!and\b|or\b|und\b)[a-zäöü]/.test(c.text)) continue;
    if (!namesTheProduct(a, tokenise(c.text))) continue;
    const pieces = [c.nameText, ...c.nameText.split(/\s-+\s/)];
    for (const piece of pieces) {
      const part = endingPart(piece, fits);
      if (part !== null && part !== a.headPart) return true;
    }
  }
  return false;
}

// ── designators, codes and model-token conflicts ─────────────────────────────────────────────

/**
 * Whether each asked designator (with its anchor word, when it needs one) is present in the
 * listing's own words, or, for a model code, in the MPN the page states as its own. Every
 * thousand-count of the asked name ("16K") must be stated too.
 */
function designatorsPresent(a: AskedView, l: ListingView, mpn: readonly Token[]): boolean {
  const codes = a.designators.every((d) => {
    const found = designatorIn(d, l.own) || (d.kind === 'code' && designatorIn(d, mpn));
    if (!found) return false;
    return !d.needsAnchor || d.kind === 'number' || d.anchor === null || l.ownForms.has(d.anchor);
  });
  if (!codes) return false;
  return (
    a.kMeasures.length === 0 ||
    compareMeasures(a.kMeasures, [...l.own, ...l.variantTokens]).kind === 'match'
  );
}

/** Another model: a stated code of the same family that is not the asked one. */
function codeClash(a: AskedView, l: ListingView): Finding | null {
  if (a.codes.length === 0) return null;
  const listed = l.own.filter((t) => t.kind === 'code');
  if (listed.length === 0) return null;
  const agrees = listed.some((t) =>
    tokenForms(t).some((f) => a.codes.some((c) => codeAgrees(compareCodes(c, f)))),
  );
  if (agrees) return null;
  let sibling = false;
  for (const t of listed) {
    for (const f of tokenForms(t)) {
      for (const c of a.codes) {
        if (!comparableCodes(c, f)) continue;
        const r = compareCodes(c, f);
        if (r === 'different')
          return { relation: 'other_model', attrs: ['model'], rule: 'code_clash' };
        if (r === 'sibling') sibling = true;
      }
    }
  }
  return sibling ? { relation: 'variant', attrs: ['configuration'], rule: 'code_sibling' } : null;
}

/**
 * The word or number right after an asked word differs: "Pro 3" for "Pro 2", "Kobra S1" for
 * "Kobra 3", "Swift 4" for "Swift", "PowerCore 10K" style numbers. A designator found after
 * another word than its anchor ("MX Anywhere 3S" for "MX Master 3S") is the same clash.
 */
function slotClash(a: AskedView, l: ListingView): Finding | null {
  const pairs = adjacent(l);
  for (let i = 0; i < a.tokens.length; i++) {
    const t = a.tokens[i];
    if (t === undefined || t.kind === 'measure' || t.kind === 'feature') continue;
    if (t.kind === 'word' && (GENERIC.has(t.key) || FILLER.has(t.key) || t.key.length < 2))
      continue;
    const next = a.tokens[i + 1];
    for (const [cur, ln] of pairs) {
      if (cur.key !== t.key || !digitBearing(ln)) continue;
      if (a.words.has(ln.key) || a.words.has(numberKey(ln))) continue;
      if (next !== undefined && (next.key === ln.key || next.key === numberKey(ln))) continue;
      if (MATERIALS.has(t.key)) {
        return { relation: 'variant', attrs: ['material'], rule: 'material_version' };
      }
      return { relation: 'other_model', attrs: ['model'], rule: 'slot_clash' };
    }
  }
  for (const d of a.designators) {
    if (d.anchor === null) continue;
    for (const [prev, t] of pairs) {
      if (!tokenForms(t).includes(d.key)) continue;
      if (prev.key === d.anchor || a.words.has(prev.key)) continue;
      if (prev.kind !== 'word' || GENERIC.has(prev.key) || FILLER.has(prev.key)) continue;
      if (!l.ownForms.has(d.anchor)) {
        return { relation: 'other_model', attrs: ['model'], rule: 'anchor_substituted' };
      }
    }
  }
  return null;
}

/** True when `w2` follows `w1` in the asked name. */
function askedNeighbours(a: AskedView, w1: string, w2: string): boolean {
  for (let i = 0; i + 1 < a.tokens.length; i++) {
    if (a.tokens[i]?.key === w1 && a.tokens[i + 1]?.key === w2) return true;
  }
  return false;
}

/** A qualifier one side has and the other lacks ("A1" for "A1 mini", "K-Mini Go" for "K-Mini"). */
function qualifierClash(a: AskedView, l: ListingView): Finding | null {
  const listingWords = new Set([...l.own, ...l.variantTokens].map((t) => t.key));
  for (const q of a.qualifiers) {
    if (!listingWords.has(q) && !l.ownForms.has(q)) {
      return { relation: 'other_model', attrs: ['model'], rule: 'qualifier_missing' };
    }
  }
  // A name word put between two neighbouring asked words: "Lono Silk Wasserkocher" for "Lono
  // Wasserkocher" names another line member. The brand may be followed by anything.
  const identity = (t: Token | undefined) =>
    t !== undefined && t.kind !== 'measure' && !GENERIC.has(t.key) && !FILLER.has(t.key);
  const brand = new Set(a.brand);
  for (const seg of l.segments) {
    for (let j = 0; j + 2 < seg.length; j++) {
      const w1 = seg[j];
      const x = seg[j + 1];
      const w2 = seg[j + 2];
      if (w1 === undefined || x === undefined || w2 === undefined) continue;
      // "P1S AMS Combo": the words before the configuration word name its unit.
      if (brand.has(w1.key) || !identity(w1) || !identity(w2) || w2.key === 'combo') continue;
      if (x.kind !== 'word' || a.words.has(x.key) || !identity(x)) continue;
      if (SIZE_ADJECTIVES.has(x.key) || COLOURS.has(x.key)) continue;
      if (askedNeighbours(a, w1.key, w2.key)) {
        return { relation: 'other_model', attrs: ['model'], rule: 'inserted_word' };
      }
    }
  }
  for (const [prev, t] of adjacent(l)) {
    if (!QUALIFIERS.has(t.key) || a.qualifiers.has(t.key) || t.plus) continue;
    if (prev.kind === 'measure' || !a.words.has(prev.key)) continue;
    if (GENERIC.has(prev.key) || FILLER.has(prev.key)) continue;
    return { relation: 'other_model', attrs: ['model'], rule: 'qualifier_extra' };
  }
  return null;
}

/** Another material ("PolyLite ABS" for "PolyLite PLA"). */
function materialClash(a: AskedView, l: ListingView): Finding | null {
  if (a.materials.size === 0) return null;
  const listed = new Set(
    l.own
      .flatMap((t) => t.parts.filter((p) => MATERIALS.has(p)))
      .concat(l.own.filter((t) => MATERIALS.has(t.key)).map((t) => t.key)),
  );
  if (listed.size === 0) return null;
  for (const m of a.materials) if (listed.has(m)) return null;
  return { relation: 'other_model', attrs: ['material'], rule: 'material_clash' };
}

/** "7-in-1" against "9-in-1": a feature count that names another model of the line. */
function featureClash(a: AskedView, l: ListingView): Finding | null {
  const inOne = (ts: readonly Token[]) =>
    new Set(ts.filter((t) => t.kind === 'feature' && /^\d+in1$/.test(t.key)).map((t) => t.key));
  const asked = inOne(a.tokens);
  const listed = inOne(l.own);
  if (asked.size === 0 || listed.size === 0) return null;
  for (const k of asked) if (listed.has(k)) return null;
  return { relation: 'other_model', attrs: ['model'], rule: 'feature_clash' };
}

/** The MPN field the page states against the asked codes (supporting evidence for tier 2). */
function mpnFieldFinding(a: AskedView, listing: MatchListing, asked: MatchAsked): Finding | null {
  // An MPN field with spaces is a name ("A1 mini", "P1S Combo"), not a part number.
  if (listing.mpn === null || /\s/.test(listing.mpn.trim())) return null;
  if (/combo/.test(compactKey(listing.mpn)) && !a.combo) {
    return { relation: 'variant', attrs: ['configuration'], rule: 'mpn_combo' };
  }
  const forms = mpnForms(listing.mpn);
  const base = forms[forms.length - 1] ?? '';
  if (!/\d/.test(base) || !/[a-z]/.test(base)) return null;
  const parts = [...forms, ...mpnParts(listing.mpn)];
  if (a.codes.some((c) => parts.some((f) => codeAgrees(compareCodes(c, f))))) return null;
  for (const c of a.codes) {
    if (!comparableCodes(c, base)) continue;
    const r = compareCodes(c, base);
    if (r === 'different') return { relation: 'other_model', attrs: ['model'], rule: 'mpn_clash' };
    if (r === 'sibling')
      return { relation: 'variant', attrs: ['configuration'], rule: 'mpn_sibling' };
  }
  if (typeof asked.mpn === 'string' && asked.mpn !== '') {
    const askedForms = mpnForms(asked.mpn);
    const askedBase = askedForms[askedForms.length - 1] ?? '';
    if (forms.some((f) => askedForms.includes(f))) return null;
    if (askedBase !== '' && askedBase === base) {
      return { relation: 'variant', attrs: ['configuration'], rule: 'mpn_suffix' };
    }
  }
  return null;
}

/** A code in the title of the same shape as the asked MPN, but not it (a store's order number). */
function titleSkuFinding(l: ListingView, asked: MatchAsked): Finding | null {
  if (typeof asked.mpn !== 'string' || asked.mpn === '') return null;
  const askedForms = mpnForms(asked.mpn);
  const askedBase = askedForms[askedForms.length - 1] ?? '';
  const askedTok = tokenise(prepare(asked.mpn.split('/')[0] ?? ''))[0];
  if (askedTok === undefined || !/\d/.test(askedBase)) return null;
  // A digits-only part number ("2953-20", "112-0032-02") is compared only in its dashed form.
  const digitsOnly = !/[a-z]/.test(askedBase);
  if (digitsOnly && askedTok.parts.length < 2) return null;
  const shape = codeShape(askedBase);
  const dashes = askedTok.parts.map((p) => p.length).join('-');
  let finding: Finding | null = null;
  for (const t of l.own) {
    for (const f of tokenForms(t)) {
      if (askedForms.includes(f)) return null;
      const comparable = digitsOnly
        ? t.kind === 'number' && t.parts.map((p) => p.length).join('-') === dashes && f === t.key
        : t.kind === 'code' && codeShape(f) === shape;
      if (!comparable) continue;
      const near = commonPrefix(f, askedBase) >= askedBase.length - 2;
      finding = near
        ? { relation: 'variant', attrs: ['configuration'], rule: 'sku_sibling' }
        : { relation: 'other_model', attrs: ['model'], rule: 'sku_clash' };
    }
  }
  return finding;
}

// ── bundles, configurations and variants ──────────────────────────────────────────────────────

/** Several products in one listing: bundle words, or "+" followed by another product's name. */
function bundleFinding(a: AskedView, l: ListingView): Finding | null {
  if (BUNDLE_RE.test(l.prepared) || BUNDLE_RE.test(l.variantText)) {
    if (!BUNDLE_RE.test(a.prepared)) return { relation: 'bundle', attrs: [], rule: 'bundle_word' };
  }
  const plus = l.prepared.split(new RegExp(JOINING_PLUS_RE.source, 'g')).slice(1);
  for (const part of plus) {
    const phrase = tokenise(part.split(/[,;|()]/)[0] ?? part);
    // "+ ACE 2 Pro Combo": the phrase names the Combo's own unit, not a second product.
    if (phrase.some((t) => t.key === 'combo')) continue;
    const named = phrase.filter(
      (t) =>
        (t.kind === 'word' && !GENERIC.has(t.key) && !FILLER.has(t.key) && t.key.length > 2) ||
        t.kind === 'code',
    );
    if (named.some((t) => !a.words.has(t.key))) {
      return { relation: 'bundle', attrs: [], rule: 'bundle_plus' };
    }
  }
  return null;
}

/**
 * Whether the listing is the Combo: its variant options decide when they say so (a Combo, or
 * "without" its unit); otherwise the title. Null when the title offers both ("P1S or P1S AMS
 * Combo") and nothing says which one this is.
 */
function listingCombo(l: ListingView): boolean | null {
  if (/\bcombo\b/.test(l.variantText)) return true;
  if (l.variantText !== '' && WITHOUT_RE.test(l.variantText)) return false;
  const hasCombo = /\bcombo\b/.test(l.prepared);
  if (hasCombo && /\bor\b/.test(l.prepared)) return null;
  return hasCombo;
}

function variantFindings(a: AskedView, l: ListingView): Finding[] {
  const out: Finding[] = [];
  const combo = listingCombo(l);
  if (combo !== null && combo !== a.combo) {
    out.push({ relation: 'variant', attrs: ['configuration'], rule: 'combo' });
  }
  // "for Business", "für Mac": the edition sits after a relation word, so the whole title counts.
  const titleKeys = new Set(tokenise(l.prepared).map((t) => t.key));
  for (const w of EDITION_WORDS) {
    if (titleKeys.has(w) && !a.words.has(w)) {
      out.push({ relation: 'variant', attrs: ['edition'], rule: 'edition' });
      break;
    }
  }
  const editionAt = l.own.findIndex((t) => t.key === 'edition');
  if (editionAt > 0 && !a.words.has('edition')) {
    const prev = l.own[editionAt - 1];
    if (prev && prev.kind === 'word' && !a.words.has(prev.key)) {
      out.push({ relation: 'variant', attrs: ['edition'], rule: 'edition' });
    }
  }
  const sink = HEATSINK_RE.exec(l.prepared);
  if (sink && !HEATSINK_RE.test(a.prepared)) {
    const before = l.prepared.slice(Math.max(0, sink.index - 12), sink.index);
    if (!WITHOUT_RE.test(before))
      out.push({ relation: 'variant', attrs: ['heatsink'], rule: 'heatsink' });
  }
  out.push(...materialFindings(a, l));
  return out;
}

/** The material grade: a plus on one side only, or another material line next to the material. */
function materialFindings(a: AskedView, l: ListingView): Finding[] {
  const out: Finding[] = [];
  const own = l.own;
  for (const w of a.plusWords) {
    const found = own.filter((t) => t.key === w);
    if (found.length > 0 && !found.some((t) => t.plus)) {
      out.push({ relation: 'variant', attrs: ['material'], rule: 'plus_missing' });
    }
  }
  for (const t of own) {
    if (t.plus && !a.plusWords.has(t.key) && a.words.has(t.key)) {
      out.push({ relation: 'variant', attrs: ['material'], rule: 'plus_extra' });
    }
  }
  for (let i = 0; i < own.length; i++) {
    const t = own[i];
    if (t === undefined) continue;
    const lineInParts =
      t.parts.length > 1 &&
      t.parts.some((p) => MATERIALS.has(p)) &&
      t.parts.some((p) => MATERIAL_LINES.has(p));
    const nearMaterial =
      MATERIAL_LINES.has(t.key) &&
      [own[i - 1], own[i + 1]].some((n) => n !== undefined && MATERIALS.has(n.key));
    if ((lineInParts || nearMaterial) && !a.words.has(t.key)) {
      out.push({ relation: 'variant', attrs: ['material'], rule: 'material_line' });
    }
  }
  return out;
}

/** A pack of several where one was asked ("2-pack", "Pack of 3", "Black*4", "3er-Pack"). */
export function packCount(text: string): number | null {
  const patterns = [
    /\bpack of (\d{1,3})\b/,
    /\b(\d{1,3})[\s-]?(?:pack|pk|er-pack|count|ct|stück|pcs|pieces)\b/,
    /[a-z)]\s*\*\s*(\d{1,2})\b/,
    /\b(\d{1,2}) ?x ?\d+(?:\.\d+)? ?(?:kg|g|l|ml)\b/,
  ];
  let found: number | null = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] !== undefined) {
      const n = Number(m[1]);
      if (n >= 1) found = Math.max(found ?? 0, n);
    }
  }
  return found;
}

function packFinding(a: AskedView, l: ListingView, asked: MatchAsked): Finding | null {
  const listed = Math.max(packCount(l.prepared) ?? 1, packCount(l.variantText) ?? 1);
  const want = asked.packQuantity ?? packCount(a.prepared) ?? 1;
  return listed !== want
    ? { relation: 'variant', attrs: ['pack_count'], rule: 'pack_count' }
    : null;
}

/** A capacity, weight or power the asked name states, against the listing's. */
function measureFinding(
  a: AskedView,
  l: ListingView,
): { finding: Finding | null; verdict: MeasureVerdict } {
  const verdict = compareMeasures(a.tokens, [...l.own, ...l.variantTokens]);
  if (verdict.kind === 'conflict') {
    const relation: MatchRelation = verdict.dim === 'k' ? 'other_model' : 'variant';
    return {
      finding: { relation, attrs: [verdict.attribute], rule: `measure_${verdict.dim}` },
      verdict,
    };
  }
  return { finding: null, verdict };
}

/** The URL path as supporting evidence: it may show a variant word after the asked model. */
function urlFinding(a: AskedView, url: string | null): Finding | null {
  if (url === null || !URL.canParse(url)) return null;
  const path = new URL(url).pathname;
  const tokens = tokenise(prepare(path.replace(/[-_/.]+/g, ' ')));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined || !a.codes.includes(t.key)) continue;
    const next = tokens[i + 1];
    if (next?.key === 'combo' && !a.combo) {
      return { relation: 'variant', attrs: ['configuration'], rule: 'url_combo' };
    }
  }
  return null;
}

// ── brands and lines ──────────────────────────────────────────────────────────────────────────

/** The listing's first name word, when it opens the title (a brand-like word, not a code). */
function leadingWord(l: ListingView): Token | null {
  for (const t of l.name) {
    if (FILLER.has(t.key) || GENERIC.has(t.key) || BUNDLE_RE.test(t.key)) continue;
    if (t.kind === 'number' || t.kind === 'measure' || t.kind === 'feature') continue;
    return t.kind === 'word' && t.key.length > 1 ? t : null;
  }
  return null;
}

/** Another brand: the listing opens with a name the asked side does not have, and never names the asked brand. */
function otherBrand(a: AskedView, l: ListingView, brandOk: boolean): boolean {
  if (brandOk || a.brand.length === 0) return false;
  if (l.brandField !== null && compactKey(l.brandField).length >= 2) return true;
  const lead = leadingWord(l);
  return lead !== null && !a.words.has(lead.key) && !l.ownForms.has(a.brand.join(''));
}

/** For an asked name without designators: every line word is in the listing's own words. */
function lineWordsPresent(a: AskedView, l: ListingView): boolean {
  return a.lineWords.every((w) => l.ownForms.has(w));
}

/** The listing names something of its own: a name word or qualifier the asked side lacks. */
function hasOwnName(a: AskedView, l: ListingView): boolean {
  return l.name.some(
    (t) =>
      t.kind === 'word' &&
      t.key.length > 1 &&
      !a.words.has(t.key) &&
      !GENERIC.has(t.key) &&
      !FILLER.has(t.key) &&
      !MATERIALS.has(t.key),
  );
}

// ── the decision ──────────────────────────────────────────────────────────────────────────────

const first = (fs: readonly (Finding | null)[]): Finding | null =>
  fs.find((f): f is Finding => f !== null) ?? null;

function verdict(f: Finding, confirmed: boolean, brandOk: boolean): TitleVerdict {
  return {
    relation: f.relation,
    differingAttrs: f.relation === 'exact' ? [] : [...new Set(f.attrs)],
    rule: f.rule,
    confirmed,
    brandConfirmed: brandOk,
  };
}

/**
 * The title rules. Precedence when several fire: a part, another brand, another line (for a name
 * without designators), another model, a bundle; then, for a listing that names the asked product,
 * a variant; then `exact` when the listing gives positive evidence, else `unknown`.
 */
export function titleRules(asked: MatchAsked, listing: MatchListing): TitleVerdict {
  return applyRules(analyseAsked(asked), analyseListing(listing), asked, listing);
}

/** The title rules over views already read (see `titleRules`). */
export function applyRules(
  a: AskedView,
  l: ListingView,
  asked: MatchAsked,
  listing: MatchListing,
): TitleVerdict {
  if (a.isPart) return decideRules(a, withTails(l), asked, listing);
  return decideRules(a, l, asked, listing);
}

function decideRules(
  a: AskedView,
  l: ListingView,
  asked: MatchAsked,
  listing: MatchListing,
): TitleVerdict {
  const brandOk = brandConfirmed(a, l);
  const hasDesignators = a.designators.length > 0;
  const mpnTokens =
    listing.mpn !== null && !/\s/.test(listing.mpn.trim()) ? tokenise(prepare(listing.mpn)) : [];
  const confirmed = hasDesignators
    ? designatorsPresent(a, l, mpnTokens)
    : (a.lineWords.length > 0 ? lineWordsPresent(a, l) : brandOk) &&
      (a.kMeasures.length === 0 ||
        compareMeasures(a.kMeasures, [...l.own, ...l.variantTokens]).kind === 'match');
  const done = (f: Finding) => verdict(f, confirmed, brandOk);

  const bundle = bundleFinding(a, l);
  // "Starter Kit for Raspberry Pi 5": a kit built around the product, not a part for it.
  const relationAt = RELATION_RE.exec(l.prepared)?.index;
  const kitFor =
    bundle !== null && relationAt !== undefined && BUNDLE_RE.test(l.prepared.slice(0, relationAt));
  if (kitFor && bundle) return done(bundle);
  if (partByName(a, l) || partByPosition(a, l)) {
    return done({ relation: 'accessory_or_part', attrs: [], rule: 'part' });
  }
  if (otherBrand(a, l, brandOk))
    return done({ relation: 'other_line', attrs: [], rule: 'other_brand' });
  const lineMissing = a.lineWords.length > 0 && !lineWordsPresent(a, l);
  if (!hasDesignators && lineMissing && brandOk && hasOwnName(a, l)) {
    return done({ relation: 'other_line', attrs: [], rule: 'other_line' });
  }
  const measures = measureFinding(a, l);
  const model = first([
    codeClash(a, l),
    slotClash(a, l),
    qualifierClash(a, l),
    materialClash(a, l),
    featureClash(a, l),
    titleSkuFinding(l, asked),
    mpnFieldFinding(a, listing, asked),
    measures.finding,
  ]);
  if (model?.relation === 'other_model') return done(model);
  if (bundle) return done(bundle);
  const support = first([model, urlFinding(a, listing.url)]);
  if (!confirmed) {
    return support ? done(support) : done({ relation: 'unknown', attrs: [], rule: 'unconfirmed' });
  }
  const variant = first([support, ...variantFindings(a, l), packFinding(a, l, asked)]);
  if (variant) return done(variant);
  if (listingCombo(l) === null) return done({ relation: 'unknown', attrs: [], rule: 'combo_open' });
  if (measures.verdict.kind === 'incomparable') {
    return done({ relation: 'unknown', attrs: [], rule: 'measure_incomparable' });
  }
  return done({
    relation: 'exact',
    attrs: [],
    rule: hasDesignators ? 'designators' : 'line_words',
  });
}
