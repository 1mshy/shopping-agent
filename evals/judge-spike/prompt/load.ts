// Loads and renders the judge prompt (S§5.4 tier 3, S§5.7 "one prompt file per task type, under
// 800 tokens, chosen by code and versioned"). The file's bytes are pinned: a changed file with an
// unchanged version is refused, so a result record's prompt version always names one text.
//
// Third-party text (listing titles, brands, variant names) goes only into the user message, as
// JSON inside delimiters, never into the system message (S§5.15). `<`, `>` and `&` are written as
// JSON escapes so no data can close or open a delimiter.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MatchAsked, MatchListing } from '../../corpus/areas/match-title-rules/contract.ts';
import { JUDGE_JSON_SCHEMA } from '../lib/chat.ts';
import { estimateTokens } from '../lib/tokens.ts';

export const PROMPT_VERSION = 'judge.v1';
export const PROMPT_FILE = new URL('./judge.v1.md', import.meta.url);
/** sha256 of judge.v1.md. Changing the file means a new version and a new file. */
export const PROMPT_SHA256 = '1d506c6781b9e52b500e2bfb937c2370c7afe5b16d2f92596a96da379dab05f2';

export interface JudgePrompt {
  readonly version: string;
  readonly sha256: string;
  readonly system: string;
  /** Template with {{asked}}, {{count}} and {{listings}}. */
  readonly user: string;
  /** Template with {{problem}} and {{count}}. */
  readonly repair: string;
}

const SECTION = /^<!-- section: ([a-z]+) -->$/m;

/** Splits the file into its version and sections. Does not check the pinned hash. */
export function parsePrompt(text: string): Omit<JudgePrompt, 'sha256'> {
  const version = /^<!-- version: ([A-Za-z0-9._-]{1,64}) -->\n/.exec(text)?.[1];
  if (!version) throw new Error('the prompt file has no version line');
  const parts = text.split(SECTION);
  const sections: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i] as string;
    if (name in sections) throw new Error(`the prompt file repeats section ${name}`);
    sections[name] = (parts[i + 1] ?? '').trim();
  }
  const { system, user, repair } = sections;
  if (!system || !user || !repair) throw new Error('the prompt file needs system, user, repair');
  return { version, system, user, repair };
}

export function loadPrompt(): JudgePrompt {
  const bytes = readFileSync(PROMPT_FILE);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== PROMPT_SHA256) {
    throw new Error(
      `${PROMPT_VERSION}: the prompt file changed. A changed prompt is a new version in a new ` +
        'file; do not edit a versioned prompt in place.',
    );
  }
  const parsed = parsePrompt(bytes.toString('utf8'));
  if (parsed.version !== PROMPT_VERSION) throw new Error('the prompt file names another version');
  return { ...parsed, sha256 };
}

/** JSON with `<`, `>` and `&` escaped, so quoted data cannot close or open a delimiter. */
export function quoteJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** What the judge sees of the asked side: the fields that are set. */
export function askedView(asked: MatchAsked): Record<string, unknown> {
  const v: Record<string, unknown> = { name: asked.name };
  if (asked.brand !== null) v.brand = asked.brand;
  if (asked.model !== null) v.model = asked.model;
  if (asked.mpn !== null) v.mpn = asked.mpn;
  if (asked.gtin !== null) v.gtin = asked.gtin;
  if (asked.mustHave.length > 0) v.mustHave = asked.mustHave;
  if (asked.packQuantity !== null) v.packQuantity = asked.packQuantity;
  return v;
}

/**
 * What the judge sees of a listing (S§5.7: "judge: listing titles/attrs only"): the title and the
 * attributes the store states. No URL, no price, no store.
 */
export function listingView(id: string, listing: MatchListing): Record<string, unknown> {
  const v: Record<string, unknown> = { id, title: listing.title };
  if (listing.brand !== null) v.brand = listing.brand;
  if (listing.mpn !== null) v.mpn = listing.mpn;
  if (listing.gtin !== null) v.gtin = listing.gtin;
  if (Object.keys(listing.variant).length > 0) v.variant = listing.variant;
  return v;
}

export interface PromptListing {
  readonly id: string;
  readonly listing: MatchListing;
}

const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{\{([a-z]+)\}\}/g, (whole, name: string) => values[name] ?? whole);

export function renderUser(
  p: JudgePrompt,
  asked: MatchAsked,
  listings: readonly PromptListing[],
): string {
  return fill(p.user, {
    asked: quoteJson(askedView(asked)),
    count: String(listings.length),
    listings: listings.map((l) => quoteJson(listingView(l.id, l.listing))).join('\n'),
  });
}

/** Why a reply was refused, in fixed words: no model text is ever echoed back. */
export const REPAIR_TEXT = {
  no_content: 'it was empty',
  refusal: 'it was a refusal',
  truncated: 'it was cut off before the end',
  not_json: 'it was not one JSON object',
  schema: 'it did not have the required keys and values',
  count: 'it did not have exactly one verdict per listing',
  ids: 'its listing ids did not match the listings given',
} as const;
export type RepairProblem = keyof typeof REPAIR_TEXT;
export const REPAIR_PROBLEMS = Object.keys(REPAIR_TEXT) as RepairProblem[];

export function renderRepair(p: JudgePrompt, problem: RepairProblem, count: number): string {
  return fill(p.repair, { problem: REPAIR_TEXT[problem], count: String(count) });
}

const withoutFields = (template: string) => template.replace(/\{\{[a-z]+\}\}/g, '');

/** The fixed part: the system message plus the user message's wrapper, without the data. */
export function fixedPartTokens(p: JudgePrompt): number {
  return estimateTokens(p.system) + estimateTokens(withoutFields(p.user));
}

/** The size table the README shows (a test keeps the two equal). */
export function promptSizeMarkdown(p: JudgePrompt): string {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const wrapper = withoutFields(p.user);
  const repair = withoutFields(p.repair);
  const schema = JSON.stringify(JUDGE_JSON_SCHEMA);
  return [
    `Prompt \`${p.version}\`, file sha256 \`${p.sha256}\`.`,
    '',
    '| Part | Estimated tokens | UTF-8 bytes |',
    '|---|--:|--:|',
    `| system message (the rules) | ${estimateTokens(p.system)} | ${bytes(p.system)} |`,
    `| user message wrapper, without the data | ${estimateTokens(wrapper)} | ${bytes(wrapper)} |`,
    `| **fixed part** | **${fixedPartTokens(p)}** | ${bytes(p.system) + bytes(wrapper)} |`,
    `| repair message, sent only on a retry, without its fields | ${estimateTokens(repair)} | ${bytes(repair)} |`,
    `| JSON schema, sent only on the \`json_schema\` rung | ${estimateTokens(schema)} | ${bytes(schema)} |`,
  ].join('\n');
}
