// "Code then checks the label against the must-have attributes" (S§5.4). An `exact` label stands
// only when no must-have attribute the listing states contradicts the asked one; a stated
// contradiction makes it a `variant` naming that attribute. A missing attribute is not a conflict.
import { compareMeasures } from './measures.ts';
import { prepare, type Token, tokenise } from './text.ts';
import { COLOURS, SHADES } from './vocabulary.ts';

export interface MustHaveItem {
  readonly attribute: string;
  readonly value: string;
}

export type MustHaveVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict'; readonly attrs: readonly string[] }
  | { readonly kind: 'incomparable'; readonly attrs: readonly string[] };

/** An attribute name as S§4.1 stores it: lower case and underscores (`chargingCase` → `charging_case`). */
export function attributeKey(attribute: string): string {
  const snake = attribute
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z][a-z_]{0,39}$/.test(snake) ? snake : 'attribute';
}

interface Colours {
  readonly base: ReadonlySet<string>;
  readonly shades: ReadonlySet<string>;
}

function coloursOf(tokens: readonly Token[]): Colours {
  const base = new Set<string>();
  const shades = new Set<string>();
  for (const t of tokens) {
    const c = COLOURS.get(t.key) ?? germanCompound(t.key);
    if (c !== undefined) base.add(c);
    if (SHADES.has(t.key)) shades.add(t.key);
  }
  return { base, shades };
}

/** German writes a shade and its colour as one word ("Himmelblau", "Nachtschwarz", "Spacegrau"). */
const GERMAN_BASES = ['schwarz', 'weiß', 'weiss', 'grau', 'silber', 'blau', 'grün', 'gelb'];
function germanCompound(key: string): string | undefined {
  const base = GERMAN_BASES.find((b) => key.endsWith(b) && key.length >= b.length + 3);
  return base === undefined ? undefined : COLOURS.get(base);
}

function coloursConflict(want: Colours, have: Colours): boolean {
  if (want.base.size === 0 || have.base.size === 0) return false;
  const overlap = [...want.base].some((c) => have.base.has(c));
  if (!overlap) return true;
  if (want.shades.size > 0 && have.shades.size > 0) {
    return ![...want.shades].some((s) => have.shades.has(s));
  }
  return false;
}

const TOOL_ONLY_RE =
  /\b(?:tool only|bare(?: tool)?|ohne akkus?|no batter(?:y|ies)|without batter(?:y|ies)|exkl\.? akkus?|excl\.? batter(?:y|ies))\b/;
const WITH_BATTERY_RE =
  /\b(?:\d+(?:\.\d+)? ?ah|batter(?:y|ies)|akkus?|ladegerät|charger|kit|set)\b/;
const CONNECTORS = ['usbc', 'lightning', 'microusb'] as const;

function connectorOf(text: string): string | null {
  const compact = text.replace(/[\s-]+/g, '');
  return CONNECTORS.find((c) => compact.includes(c)) ?? null;
}

/**
 * The must-have attributes against what the listing states. `ownText` is the listing's own title
 * text (name and inclusions, prepared); `variantTokens` its variant options; `ownTokens` the
 * title's own tokens.
 */
export function checkMustHave(
  items: readonly MustHaveItem[],
  ownTokens: readonly Token[],
  ownText: string,
  variantTokens: readonly Token[],
): MustHaveVerdict {
  const conflicts: string[] = [];
  const incomparable: string[] = [];
  const listingColours =
    coloursOf(variantTokens).base.size > 0 ? coloursOf(variantTokens) : coloursOf(ownTokens);
  const listingTokens = [...ownTokens, ...variantTokens];
  for (const item of items) {
    const key = attributeKey(item.attribute);
    const valueText = prepare(item.value);
    const value = tokenise(valueText);
    if (coloursConflict(coloursOf(value), listingColours)) {
      conflicts.push(key);
      continue;
    }
    const m = compareMeasures(value, listingTokens);
    if (m.kind === 'conflict') {
      conflicts.push(key);
      continue;
    }
    if (m.kind === 'incomparable') incomparable.push(key);
    const wantToolOnly = TOOL_ONLY_RE.test(valueText);
    const listingToolOnly = TOOL_ONLY_RE.test(ownText);
    const listingBattery = WITH_BATTERY_RE.test(ownText.replace(TOOL_ONLY_RE, ' '));
    if (wantToolOnly && !listingToolOnly && listingBattery) {
      conflicts.push(key);
      continue;
    }
    if (!wantToolOnly && WITH_BATTERY_RE.test(valueText) && listingToolOnly) {
      conflicts.push(key);
      continue;
    }
    const want = connectorOf(valueText);
    const have = connectorOf(ownText);
    if (want !== null && have !== null && want !== have) conflicts.push(key);
  }
  if (conflicts.length > 0) return { kind: 'conflict', attrs: [...new Set(conflicts)] };
  if (incomparable.length > 0) return { kind: 'incomparable', attrs: [...new Set(incomparable)] };
  return { kind: 'ok' };
}
