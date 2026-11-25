// A bounded, strict JSON reader for platform payloads (RFC 8259). It differs from `JSON.parse` in
// the one way the readers need: a number token keeps its source text (`JsonNumber`), so an amount
// such as Magento's `"value": 56.25` is read from its digits and never passes through a float
// (S§2.2). Payload text is data: nothing in it is evaluated, and every limit is checked as it is
// read, so hostile input (a challenge page, truncated JSON, deep nesting, megabytes of text) gives
// a refusal and never throws.

/** A JSON number as written in the payload ("56.25", "12900", "-0", "1e3"). */
export class JsonNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

export type JsonValue = null | boolean | string | JsonNumber | JsonArray | JsonObject;
export type JsonArray = readonly JsonValue[];
/** A JSON object, built without a prototype: `__proto__` is an ordinary key here. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonParse =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: string };

/** Deeper than any platform payload: a Magento variant price sits at depth 11. */
export const JSON_MAX_DEPTH = 64;
/**
 * Longer than any body fetchPage delivers on the `api` rung (JSON_MAX_BODY_BYTES, 4 MiB, which
 * decodes to at most that many characters), so it only guards a caller that skipped the cap.
 */
export const JSON_MAX_LENGTH = 8 * 1024 * 1024;
/** Values in one document: a 4 MiB body cannot hold more than about 2 million. */
export const JSON_MAX_VALUES = 2_500_000;

export interface JsonLimits {
  readonly maxLength?: number;
  readonly maxDepth?: number;
  readonly maxValues?: number;
}

class Refusal {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

class Reader {
  readonly #text: string;
  readonly #maxDepth: number;
  readonly #maxValues: number;
  #at = 0;
  #values = 0;

  constructor(text: string, maxDepth: number, maxValues: number) {
    this.#text = text;
    this.#maxDepth = maxDepth;
    this.#maxValues = maxValues;
  }

  document(): JsonValue {
    if (this.#text.charCodeAt(0) === 0xfeff) this.#at = 1;
    const value = this.#value(0);
    this.#space();
    if (this.#at !== this.#text.length) this.#fail('text after the document');
    return value;
  }

  #fail(what: string): never {
    throw new Refusal(`${what} at character ${this.#at}`);
  }

  #space(): void {
    const text = this.#text;
    let at = this.#at;
    for (;;) {
      const c = text.charCodeAt(at);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) at++;
      else break;
    }
    this.#at = at;
  }

  #count(): void {
    this.#values++;
    if (this.#values > this.#maxValues) this.#fail(`more than ${this.#maxValues} values`);
  }

  #value(depth: number): JsonValue {
    this.#space();
    this.#count();
    const c = this.#text.charCodeAt(this.#at);
    if (c === 0x7b /* { */) return this.#object(depth + 1);
    if (c === 0x5b /* [ */) return this.#array(depth + 1);
    if (c === 0x22 /* " */) return this.#string();
    if (c === 0x2d /* - */ || (c >= 0x30 && c <= 0x39)) return this.#number();
    if (this.#word('true')) return true;
    if (this.#word('false')) return false;
    if (this.#word('null')) return null;
    return this.#fail(Number.isNaN(c) ? 'end of text where a value was expected' : 'not a value');
  }

  #word(word: string): boolean {
    if (!this.#text.startsWith(word, this.#at)) return false;
    this.#at += word.length;
    return true;
  }

  #number(): JsonNumber {
    NUMBER.lastIndex = this.#at;
    const match = NUMBER.exec(this.#text);
    if (match === null) return this.#fail('malformed number');
    const end = this.#at + match[0].length;
    const next = this.#text.charCodeAt(end);
    // "0123", "1.", "1e": the grammar stops early; what follows must not continue the token.
    if ((next >= 0x30 && next <= 0x39) || next === 0x2e || next === 0x65 || next === 0x45) {
      this.#at = end;
      return this.#fail('malformed number');
    }
    this.#at = end;
    return new JsonNumber(match[0]);
  }

  #string(): string {
    const text = this.#text;
    let at = this.#at + 1;
    let out = '';
    let start = at;
    for (;;) {
      const c = text.charCodeAt(at);
      if (Number.isNaN(c)) {
        this.#at = at;
        return this.#fail('unterminated string');
      }
      if (c === 0x22) {
        out += text.slice(start, at);
        this.#at = at + 1;
        return out;
      }
      if (c < 0x20) {
        this.#at = at;
        return this.#fail('control character in a string');
      }
      if (c !== 0x5c) {
        at++;
        continue;
      }
      out += text.slice(start, at);
      const e = text[at + 1];
      at += 2;
      switch (e) {
        case '"':
        case '\\':
        case '/':
          out += e;
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'u': {
          const hex = text.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.#at = at;
            return this.#fail('bad \\u escape');
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          at += 4;
          break;
        }
        default:
          this.#at = at - 1;
          return this.#fail('bad escape');
      }
      start = at;
    }
  }

  #array(depth: number): JsonArray {
    if (depth > this.#maxDepth) this.#fail(`nesting deeper than ${this.#maxDepth}`);
    this.#at++;
    const items: JsonValue[] = [];
    this.#space();
    if (this.#text.charCodeAt(this.#at) === 0x5d) {
      this.#at++;
      return items;
    }
    for (;;) {
      items.push(this.#value(depth));
      this.#space();
      const c = this.#text.charCodeAt(this.#at);
      this.#at++;
      if (c === 0x5d) return items;
      if (c !== 0x2c) {
        this.#at--;
        this.#fail('expected , or ] in an array');
      }
    }
  }

  #object(depth: number): JsonObject {
    if (depth > this.#maxDepth) this.#fail(`nesting deeper than ${this.#maxDepth}`);
    this.#at++;
    const object: Record<string, JsonValue> = Object.create(null);
    this.#space();
    if (this.#text.charCodeAt(this.#at) === 0x7d) {
      this.#at++;
      return object;
    }
    for (;;) {
      this.#space();
      if (this.#text.charCodeAt(this.#at) !== 0x22) this.#fail('expected a key');
      const key = this.#string();
      this.#space();
      if (this.#text.charCodeAt(this.#at) !== 0x3a) this.#fail('expected :');
      this.#at++;
      object[key] = this.#value(depth);
      this.#space();
      const c = this.#text.charCodeAt(this.#at);
      this.#at++;
      if (c === 0x7d) return object;
      if (c !== 0x2c) {
        this.#at--;
        this.#fail('expected , or } in an object');
      }
    }
  }
}

/** Reads one JSON document. Never throws: anything that is not strict JSON within the limits is refused. */
export function parseJson(text: string, limits: JsonLimits = {}): JsonParse {
  const maxLength = limits.maxLength ?? JSON_MAX_LENGTH;
  if (typeof text !== 'string') return { ok: false, error: 'not text' };
  if (text.length > maxLength) {
    return { ok: false, error: `text of ${text.length} characters is over the ${maxLength} limit` };
  }
  try {
    const reader = new Reader(
      text,
      limits.maxDepth ?? JSON_MAX_DEPTH,
      limits.maxValues ?? JSON_MAX_VALUES,
    );
    return { ok: true, value: reader.document() };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    // A RangeError from the engine (out of memory, a stack limit) is a refusal too.
    return { ok: false, error: 'the text could not be read' };
  }
}

/** The value as an object, or null when it is anything else (an array, a number, null). */
export function asObject(value: JsonValue | undefined): JsonObject | null {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
    ? (value as JsonObject)
    : null;
}

export function asArray(value: JsonValue | undefined): JsonArray | null {
  return Array.isArray(value) ? (value as JsonArray) : null;
}

/** An own field of an object; undefined when the object is null or has no such field. */
export function getField(object: JsonObject | null, key: string): JsonValue | undefined {
  return object !== null && Object.hasOwn(object, key) ? object[key] : undefined;
}

export function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function asBoolean(value: JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** The source text of a number token, or null. */
export function numberText(value: JsonValue | undefined): string | null {
  return value instanceof JsonNumber ? value.text : null;
}

/** A path of fields through nested objects; undefined as soon as one step is missing. */
export function getPath(value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of keys) {
    current = getField(asObject(current), key);
    if (current === undefined) return undefined;
  }
  return current;
}
