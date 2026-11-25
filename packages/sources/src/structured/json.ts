// A lenient, bounded JSON reader for JSON-LD blocks (S§5.2). Two reasons not to use JSON.parse:
//
// - Money: JSON.parse turns `"price": 18.99` into a float. Here every number stays its source text
//   (`JsonNumber`), so a price is read from its digits by packages/core and never touches a float
//   (S§2.1, S§2.2).
// - Real pages: stores ship JSON-LD that strict JSON refuses (trailing commas, raw line breaks
//   inside strings, comments, an HTML comment or CDATA wrapper, two objects in one block). Those
//   are read; anything else is refused with a reason, never thrown.
//
// The work is bounded (nesting depth, number of values), so a hostile block of several MB or a
// million nested brackets ends in a refusal, not a stack overflow. Objects have no prototype, so a
// "__proto__" key is an ordinary key. Nothing read here is evaluated (S§2.7).

/** A JSON number as written in the source ("249", "18.99", "1e3"). Never converted to a float. */
export class JsonNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | boolean | null | JsonNumber | JsonValue[] | JsonObject;

export type JsonParse =
  | { readonly ok: true; readonly value: JsonValue; readonly nodes: number }
  | { readonly ok: false; readonly error: string };

export interface JsonLimits {
  /** Arrays and objects nested deeper than this are refused. */
  readonly maxDepth?: number;
  /** More values than this in one text are refused. */
  readonly maxNodes?: number;
}

export const JSON_DEFAULT_LIMITS = { maxDepth: 64, maxNodes: 200_000 } as const;

class Refusal {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** Reads one JSON-LD block. Never throws. */
export function parseLenientJson(text: string, limits: JsonLimits = {}): JsonParse {
  const maxDepth = limits.maxDepth ?? JSON_DEFAULT_LIMITS.maxDepth;
  const maxNodes = limits.maxNodes ?? JSON_DEFAULT_LIMITS.maxNodes;
  if (typeof text !== 'string') return { ok: false, error: 'not text' };
  let i = 0;
  let nodes = 0;

  const fail = (what: string): never => {
    throw new Refusal(`${what} at character ${i}`);
  };

  const skip = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xfeff) {
        i += 1;
      } else if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end + 1;
      } else if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        if (end === -1) fail('an unclosed comment');
        i = end + 2;
      } else if (text.startsWith('<!--', i)) {
        i += 4;
      } else if (text.startsWith('-->', i)) {
        i += 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        i += 9;
      } else if (text.startsWith(']]>', i)) {
        i += 3;
      } else {
        return;
      }
    }
  };

  const count = (): void => {
    nodes += 1;
    if (nodes > maxNodes) fail(`more than ${maxNodes} values`);
  };

  const readString = (): string => {
    // text[i] is the opening quote.
    i += 1;
    let out = '';
    let start = i;
    for (;;) {
      if (i >= text.length) fail('an unclosed string');
      const c = text[i];
      if (c === '"') {
        out += text.slice(start, i);
        i += 1;
        return out;
      }
      if (c === '\\') {
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === undefined) fail('an unclosed string');
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('a bad \\u escape');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
        } else {
          // An unknown escape keeps its character, as browsers' JSON-LD readers tend to.
          out += ESCAPES[e as string] ?? e;
          i += 2;
        }
        start = i;
        continue;
      }
      // Raw control characters (line breaks, tabs) are kept: stores print them in descriptions.
      i += 1;
    }
  };

  const readValue = (depth: number): JsonValue => {
    skip();
    count();
    const c = text[i];
    if (c === '{') {
      if (depth >= maxDepth) fail(`nesting deeper than ${maxDepth}`);
      i += 1;
      const obj: JsonObject = Object.create(null);
      skip();
      while (text[i] !== '}') {
        if (text[i] !== '"') fail('an object key that is not a string');
        const key = readString();
        skip();
        if (text[i] !== ':') fail('a missing ":"');
        i += 1;
        obj[key] = readValue(depth + 1);
        skip();
        if (text[i] === ',') {
          i += 1;
          skip();
        } else if (text[i] !== '}') {
          fail('a missing "," or "}"');
        }
      }
      i += 1;
      return obj;
    }
    if (c === '[') {
      if (depth >= maxDepth) fail(`nesting deeper than ${maxDepth}`);
      i += 1;
      const list: JsonValue[] = [];
      skip();
      while (text[i] !== ']') {
        list.push(readValue(depth + 1));
        skip();
        if (text[i] === ',') {
          i += 1;
          skip();
        } else if (text[i] !== ']') {
          fail('a missing "," or "]"');
        }
      }
      i += 1;
      return list;
    }
    if (c === '"') return readString();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m !== null) {
      i += m[0].length;
      return new JsonNumber(m[0]);
    }
    return fail(i >= text.length ? 'the end of the text' : `an unexpected "${c}"`);
  };

  try {
    const values: JsonValue[] = [];
    skip();
    if (i >= text.length) fail('no value');
    while (i < text.length) {
      values.push(readValue(0));
      skip();
      // Two objects in one block, sometimes with a comma between them.
      if (text[i] === ',') {
        i += 1;
        skip();
      }
      if (i < text.length && text[i] !== '{' && text[i] !== '[') fail(`an unexpected "${text[i]}"`);
    }
    const value = values.length === 1 ? (values[0] as JsonValue) : values;
    return { ok: true, value, nodes };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    // RangeError (stack) cannot happen with the depth bound, but a refusal is the only answer.
    return { ok: false, error: 'the text could not be read' };
  }
}
