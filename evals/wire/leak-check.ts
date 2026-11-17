// The fail-closed net (S§5.13). It runs over exactly what would be written, after redaction,
// and is deliberately independent of `redact.ts`: it imports nothing from it and keeps its own
// list of forms, so a gap in redaction is not repeated here. It errs towards refusing.
//
// For each secret it looks, case-insensitively, in the serialized file, the decoded body and any
// extra places (such as the output path), each also JSON-unescaped (`\uXXXX`, `\/`, ...) and
// URL-decoded once and twice, for:
// - any run of 8 or more characters of the secret (a sliding window);
// - the base64 and base64url encodings of the secret at all three byte alignments;
// - a masked echo that ends in the secret's last 4 characters, such as `sk-...WXYZ`.
import { bodyBytes, serializeFixture, type WireFixture } from './format.ts';

const MIN_RUN = 8;

const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const unescapeJson = (s: string) =>
  s.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, e: string) =>
    e.length === 5 ? String.fromCharCode(Number.parseInt(e.slice(1), 16)) : (JSON_ESCAPES[e] ?? e),
  );

const percentDecode = (s: string) =>
  s.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

function views(text: string): string[] {
  const out = new Set<string>();
  for (const base of [text, unescapeJson(text)]) {
    const once = percentDecode(base);
    for (const v of [base, once, percentDecode(once), unescapeJson(once)]) out.add(v.toLowerCase());
  }
  return [...out];
}

function needles(secret: string): { plain: string[]; masked: RegExp | null } {
  const lower = secret.toLowerCase();
  const runs =
    lower.length <= MIN_RUN
      ? [lower]
      : Array.from({ length: lower.length - MIN_RUN + 1 }, (_, i) => lower.slice(i, i + MIN_RUN));
  const bytes = Buffer.from(secret, 'utf8');
  const encoded: string[] = [];
  for (const k of [0, 1, 2]) {
    const shifted = Buffer.concat([Buffer.alloc(k), bytes]);
    // Characters that encode only the secret's bits, not the shift or the padding.
    const from = Math.ceil((8 * k) / 6);
    const to = Math.floor((8 * (k + bytes.length)) / 6);
    for (const enc of ['base64', 'base64url'] as const) {
      const core = shifted.toString(enc).slice(from, to).toLowerCase();
      if (core.length >= MIN_RUN) encoded.push(core);
    }
  }
  const tail = lower.slice(-4).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const masked = lower.length > 4 ? new RegExp(`[*.•…]{2,}${tail}`) : null;
  return { plain: [...new Set([...runs, ...encoded])], masked };
}

/** True when any secret shows up in `text` in any of the forms above. */
export function secretsIn(text: string, secrets: readonly string[]): boolean {
  const vs = views(text);
  return secrets.some((s) => {
    const n = needles(s);
    return vs.some((v) => n.plain.some((p) => v.includes(p)) || (n.masked?.test(v) ?? false));
  });
}

/** Where, if anywhere, a secret survives in what would be written. Empty means safe. */
export function findSecretLeaks(
  f: WireFixture,
  secrets: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): string[] {
  const usable = secrets.filter((s) => s.length > 0);
  if (usable.length === 0) return [];
  const places: [string, string][] = [
    ['fixture file', serializeFixture(f)],
    ['response body', Buffer.from(bodyBytes(f)).toString('latin1')],
    ...Object.entries(extra),
  ];
  return places.filter(([, text]) => secretsIn(text, usable)).map(([where]) => where);
}
