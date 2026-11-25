// Model codes (alphanumeric designators such as DCD793D1, WH-1000XM5, MK4S) and how two of them
// relate. Shared by tier 1 (MPN equality) and tier 2 (model-token conflicts).

/** Lower case, NFKC, letters and digits only: `WH-1000XM5/B` → `wh1000xm5b`. */
export function compactKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The MPN as compared: compact, and also without a trailing region or colour suffix after a
 * slash (`WH1000XM5/B`, `HX6810/50`, `MTJV3AM/A` keep their base before the slash).
 */
export function mpnForms(raw: string): string[] {
  const forms = new Set<string>();
  const full = compactKey(raw);
  if (full !== '') forms.add(full);
  const base = compactKey(raw.split('/')[0] ?? '');
  if (base !== '' && /\d/.test(base)) forms.add(base);
  // A short market or condition suffix after a dash ("A3035G11-F0", "DCD791NT-XJ").
  const stem = compactKey(raw.trim().replace(/[-_][a-z0-9]{1,3}$/i, ''));
  if (stem !== full && /\d/.test(stem) && /[a-z]/.test(stem)) forms.add(stem);
  return [...forms];
}

/**
 * Two part numbers name the same item: equal once compact, or equal before a market, colour or
 * condition suffix that only one of them writes ("WH1000XM5/B" and "WH-1000XM5"; "A3035G11-F0"
 * and "A3035G11"). Two different suffixes ("QP2834/23" and "QP2834/60") are two items.
 */
export function sameMpn(a: string, b: string): boolean {
  const ca = compactKey(a);
  const cb = compactKey(b);
  if (ca === '' || cb === '') return false;
  if (ca === cb) return true;
  const [ba, sa] = mpnBaseSuffix(a);
  const [bb, sb] = mpnBaseSuffix(b);
  return ba !== '' && ba === bb && (sa === '' || sb === '') && /\d/.test(ba);
}

/**
 * A part number split into its base and a short suffix after a slash or a dash ("ZX4400/B" →
 * ["zx4400", "b"], "ZX4400-BLK" → ["zx4400", "blk"]); the suffix is empty when there is none.
 */
export function mpnBaseSuffix(raw: string): readonly [string, string] {
  const t = raw.trim();
  const slash = t.indexOf('/');
  if (slash > 0) return [compactKey(t.slice(0, slash)), compactKey(t.slice(slash + 1))];
  const dash = /^(.*\d.*)[-_]([a-z0-9]{1,3})$/i.exec(t);
  if (dash?.[1] !== undefined && dash[2] !== undefined && /[a-z]/i.test(dash[1])) {
    return [compactKey(dash[1]), compactKey(dash[2])];
  }
  return [compactKey(t), ''];
}

/** The dash- or slash-separated parts of an MPN, compact ("RM-BES870XL" → ["rm", "bes870xl"]). */
export function mpnParts(raw: string): string[] {
  return raw
    .split(/[-/_.\s]+/)
    .map(compactKey)
    .filter((p) => p !== '');
}

/**
 * How a listing's code relates to an asked code.
 * - same: equal.
 * - narrower / broader: one extends the other with letters after a shared run of at least three
 *   digits (BES870 and BES870XL; DCD791 and DCD791NT): the same base model number, one more
 *   specific. Not a conflict.
 * - sibling: the same base model number with different letter suffixes after a run of at least
 *   three digits (DCD793D1 and DCD793B, DCF850B and DCF850P1): another configuration (a variant).
 * - different: another model (DCD798D1 for DCD793D1, WH-1000XM4 for WH-1000XM5, MK3S for MK4S).
 */
export type CodeRelation = 'same' | 'narrower' | 'broader' | 'sibling' | 'different';

const HEAD_RE = /^([a-z]*)(\d+)(.*)$/;

export function compareCodes(asked: string, listing: string): CodeRelation {
  if (asked === listing) return 'same';
  const a = HEAD_RE.exec(asked);
  const l = HEAD_RE.exec(listing);
  if (!a || !l) return 'different';
  const [, aLetters, aDigits = '', aRest = ''] = a;
  const [, lLetters, lDigits = '', lRest = ''] = l;
  if (aLetters !== lLetters || aDigits !== lDigits || aDigits.length < 3) return 'different';
  if (aRest === '') return /^[a-z]/.test(lRest) ? 'narrower' : 'different';
  if (lRest === '') return /^[a-z]/.test(aRest) ? 'broader' : 'different';
  const letters = (s: string) => s.replace(/\d/g, '');
  // XM4 against XM5: the same letters, another number after them, so another generation.
  return letters(aRest) === letters(lRest) ? 'different' : 'sibling';
}

/** A relation that does not deny the asked model: the listing names it or a form of it. */
export function codeAgrees(r: CodeRelation): boolean {
  return r === 'same' || r === 'narrower' || r === 'broader';
}

/**
 * Two codes of one family, so that a difference between them is a conflict and not just two
 * unrelated numbers on a page: the same leading letters (DCD..., WH..., MK...), or both purely
 * numeric heads of the same length.
 */
export function comparableCodes(a: string, b: string): boolean {
  const la = /^[a-z]+/.exec(a)?.[0] ?? '';
  const lb = /^[a-z]+/.exec(b)?.[0] ?? '';
  if (la === '' && lb === '') return a.length === b.length;
  return la !== '' && lb !== '' && la[0] === lb[0];
}

/** The shape of a code: letters as `a`, digits as `9` (`06019n3200` → `99999a9999`). */
export function codeShape(code: string): string {
  return code.replace(/[a-z]/g, 'a').replace(/\d/g, '9');
}

/** Length of the common prefix of two strings. */
export function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
