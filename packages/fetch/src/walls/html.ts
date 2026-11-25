// Reads the wall classifier's evidence out of an HTML document: its title, its visible text and
// the bot-manager signals in its markup. A small scanner of its own, not an HTML parser:
//
// - The classifier needs three things, not a tree. parse5 (which `packages/sources` uses) builds
//   the whole DOM, about ten times the document in memory, for every page the HTTP rungs read
//   (6 MiB at most, about 12 in flight), only for this module to throw it away. The scanner is
//   one forward pass with no backtracking: each step moves past at least one character, so its
//   work is linear in the document, and what it keeps is capped (a 4 KiB text excerpt, a 1 KiB
//   title, 64 signals of 512 characters).
// - Where it is cruder than a parser (implied end tags, foreign content, the adoption agency), the
//   cost is a few characters of visible text more or less, which no rule here is sensitive to.
//
// Page text is data (S§2.7): nothing read here is executed, fetched or followed.
import type { MarkupSignal } from './evidence.ts';

/** Characters scanned; the HTTP rungs cap a page at 6 MiB, so this is a guard, not a limit. */
export const HTML_SCAN_MAX_CHARS = 8 * 1024 * 1024;
/** Visible text kept as the excerpt; `visibleChars` still counts all of it. */
export const VISIBLE_TEXT_EXCERPT_CHARS = 4_096;
/** Title characters kept; a longer title ends in "…" and so never equals a known one. */
export const TITLE_MAX_CHARS = 1_024;
export const MAX_SIGNALS = 64;
export const SIGNAL_MAX_CHARS = 512;
/** Inline script characters searched per script, and scripts searched per page. */
const INLINE_SCRIPT_SCAN_CHARS = 4_096;
const INLINE_SCRIPTS_SCANNED = 32;
const ATTRIBUTE_MAX_CHARS = 2_048;

export interface HtmlEvidence {
  readonly title: string;
  readonly visibleText: string;
  readonly visibleChars: number;
  readonly markup: readonly MarkupSignal[];
}

/** Elements whose content is not shown and not parsed as markup by a browser running scripts. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'template',
  'noscript',
  'iframe',
  'noembed',
  'noframes',
  'xmp',
]);

/** Elements that do not break a line: no space is put between their text and their neighbours'. */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
]);

/** Element ids that are bot-manager markup (read by the classifier's markup rules). */
const SIGNAL_IDS = new Set([
  'px-captcha',
  'challenge-running',
  'challenge-stage',
  'challenge-form',
  'challenge-body-text',
  'challenge-error-text',
  'cf-challenge-running',
  'sec-if-cpt-container',
]);

/** iframe and script sources worth keeping: bot managers' and captcha widgets' hosts and paths. */
const SIGNAL_URL =
  /captcha-delivery\.com|_incapsula_resource|\/cdn-cgi\/challenge-platform\/|\/_sec\/cp_challenge\/|awswaf\.com|\/recaptcha\/|hcaptcha\.com|arkoselabs\.com|funcaptcha\.com|geetest\.com|perimeterx|px-cdn\.net|px-cloud\.net/;

/** Inline script fragments worth keeping (the classifier reads them, nothing runs them). */
const SIGNAL_SCRIPT = [
  /\bdd\s*=\s*\{[^}]{0,400}?['"]rt['"]\s*:\s*['"][a-z]['"]/,
  /\b_cf_chl_opt\b/,
  /\bbm-verify\b/,
];

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));?/g;

/** Character references decoded: numeric ones, and the few named ones block pages use. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return '�';
    if (code >= 0xd800 && code <= 0xdfff) return '�';
    return String.fromCodePoint(code);
  });
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** URL as a signal value: lower-cased, without query or fragment, capped. */
function urlSignal(url: string): string {
  const cut = url.trim().split(/[?#]/, 1)[0] ?? '';
  return cut.toLowerCase().slice(0, SIGNAL_MAX_CHARS);
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  /** The attributes the scanner uses (id, src, action), lower-case names, raw values. */
  readonly attrs: ReadonlyMap<string, string>;
  /** Index just past the tag's `>`, or the text's length when the tag never closes. */
  readonly end: number;
}

const KEPT_ATTRIBUTES = new Set(['id', 'src', 'action']);

/** Reads the tag starting at `start` (`<name` or `</name`). Linear in the tag's length. */
function readTag(text: string, start: number): Tag {
  const n = text.length;
  let j = start + 1;
  const closing = text.charCodeAt(j) === 0x2f;
  if (closing) j++;
  const nameStart = j;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (isSpace(c) || c === 0x2f || c === 0x3e) break;
    j++;
  }
  const name = text.slice(nameStart, Math.min(j, nameStart + 64)).toLowerCase();
  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === 0x3e) return { name, closing, selfClosing, attrs, end: j + 1 };
    if (isSpace(c)) {
      j++;
      continue;
    }
    if (c === 0x2f) {
      selfClosing = text.charCodeAt(j + 1) === 0x3e;
      j++;
      continue;
    }
    const attrStart = j;
    while (j < n) {
      const d = text.charCodeAt(j);
      if (isSpace(d) || d === 0x3d || d === 0x3e || d === 0x2f) break;
      j++;
    }
    // A lone '=' or other stray character: step over it.
    if (j === attrStart) {
      j++;
      continue;
    }
    const attrName = text.slice(attrStart, Math.min(j, attrStart + 32)).toLowerCase();
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (text.charCodeAt(j) !== 0x3d) continue;
    j++;
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    let value: string;
    const quote = text.charCodeAt(j);
    if (quote === 0x22 || quote === 0x27) {
      const close = text.indexOf(quote === 0x22 ? '"' : "'", j + 1);
      const valueEnd = close === -1 ? n : close;
      value = text.slice(j + 1, Math.min(valueEnd, j + 1 + ATTRIBUTE_MAX_CHARS));
      j = close === -1 ? n : close + 1;
    } else {
      const valueStart = j;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (isSpace(d) || d === 0x3e) break;
        j++;
      }
      value = text.slice(valueStart, Math.min(j, valueStart + ATTRIBUTE_MAX_CHARS));
    }
    if (KEPT_ATTRIBUTES.has(attrName) && !attrs.has(attrName)) {
      attrs.set(attrName, decodeEntities(value));
    }
  }
  return { name, closing, selfClosing, attrs, end: n };
}

const CLOSERS = new Map<string, RegExp>();

/** Index of the `</name` that ends a raw-text element, or -1. */
function closingTag(text: string, name: string, from: number): number {
  let re = CLOSERS.get(name);
  if (re === undefined) {
    re = new RegExp(`</${name}(?=[\\s/>]|$)`, 'gi');
    CLOSERS.set(name, re);
  }
  re.lastIndex = from;
  const match = re.exec(text);
  return match === null ? -1 : match.index;
}

/** The title, visible text and bot-manager signals of an HTML document. Never throws. */
export function readHtml(html: string): HtmlEvidence {
  const text = html.length > HTML_SCAN_MAX_CHARS ? html.slice(0, HTML_SCAN_MAX_CHARS) : html;
  const n = text.length;
  const markup: MarkupSignal[] = [];
  const seen = new Set<string>();
  let title: string | null = null;
  let excerpt = '';
  let count = 0;
  let pendingSpace = false;
  let svgDepth = 0;
  let inlineScripts = 0;

  const signal = (place: MarkupSignal['in'], value: string) => {
    if (markup.length >= MAX_SIGNALS || value === '') return;
    const key = `${place} ${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    markup.push({ in: place, value });
  };

  const emit = (piece: string) => {
    count += piece.length;
    if (excerpt.length < VISIBLE_TEXT_EXCERPT_CHARS) {
      excerpt += piece.slice(0, VISIBLE_TEXT_EXCERPT_CHARS - excerpt.length);
    }
  };

  const addText = (raw: string) => {
    const collapsed = decodeEntities(raw).replace(/\s+/g, ' ');
    if (collapsed === '' || collapsed === ' ') {
      if (collapsed === ' ') pendingSpace = true;
      return;
    }
    let core = collapsed;
    if (core.startsWith(' ')) {
      pendingSpace = true;
      core = core.slice(1);
    }
    const trailing = core.endsWith(' ');
    if (trailing) core = core.slice(0, -1);
    if (pendingSpace && count > 0) emit(' ');
    emit(core);
    pendingSpace = trailing;
  };

  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      if (svgDepth === 0) addText(text.slice(i));
      break;
    }
    if (lt > i && svgDepth === 0) addText(text.slice(i, lt));
    const next = text.charCodeAt(lt + 1);
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (next === 0x21 || next === 0x3f) {
      // A doctype, CDATA section or processing instruction.
      const close = text.indexOf('>', lt + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    const isTag = isLetter(next) || (next === 0x2f && isLetter(text.charCodeAt(lt + 2)));
    if (!isTag) {
      if (svgDepth === 0) addText('<');
      i = lt + 1;
      continue;
    }
    const tag = readTag(text, lt);
    i = tag.end;
    if (!INLINE.has(tag.name)) pendingSpace = true;
    if (tag.closing) {
      if (tag.name === 'svg' && svgDepth > 0) svgDepth--;
      continue;
    }
    if (tag.name === 'svg' && !tag.selfClosing) svgDepth++;

    const id = tag.attrs.get('id')?.trim().toLowerCase();
    if (id !== undefined && SIGNAL_IDS.has(id)) signal('element_id', id);
    const src = tag.attrs.get('src');
    if ((tag.name === 'iframe' || tag.name === 'script') && src !== undefined) {
      const value = urlSignal(src);
      if (SIGNAL_URL.test(value))
        signal(tag.name === 'iframe' ? 'iframe_src' : 'script_src', value);
    }
    const action = tag.attrs.get('action');
    if (tag.name === 'form' && action !== undefined) {
      const value = urlSignal(action);
      if (/\/errors(?:_page)?\/validatecaptcha\/?$/.test(value)) signal('form_action', value);
    }

    if (!RAW_TEXT.has(tag.name) || tag.selfClosing) continue;
    const close = closingTag(text, tag.name, i);
    const contentEnd = close === -1 ? n : close;
    if (tag.name === 'title' && title === null && svgDepth === 0) {
      const raw = text.slice(i, Math.min(contentEnd, i + TITLE_MAX_CHARS * 2));
      let value = decodeEntities(raw).replace(/\s+/g, ' ').trim();
      if (value.length > TITLE_MAX_CHARS || contentEnd - i > TITLE_MAX_CHARS * 2) {
        value = `${value.slice(0, TITLE_MAX_CHARS)}…`;
      }
      title = value;
    } else if (tag.name === 'textarea' && svgDepth === 0) {
      addText(text.slice(i, contentEnd));
    } else if (
      tag.name === 'script' &&
      src === undefined &&
      inlineScripts < INLINE_SCRIPTS_SCANNED
    ) {
      inlineScripts++;
      const head = text.slice(i, Math.min(contentEnd, i + INLINE_SCRIPT_SCAN_CHARS)).toLowerCase();
      for (const pattern of SIGNAL_SCRIPT) {
        const match = pattern.exec(head);
        if (match) signal('inline_script', match[0].slice(0, SIGNAL_MAX_CHARS));
      }
    }
    if (close === -1) break;
    const after = text.indexOf('>', close);
    i = after === -1 ? n : after + 1;
    pendingSpace = true;
  }

  // An excerpt ends in " …" and stays shorter than the count, as the evidence contract says.
  const visibleText = count > excerpt.length ? `${excerpt.slice(0, -2).trimEnd()} …` : excerpt;
  return { title: title ?? '', visibleText, visibleChars: count, markup };
}
