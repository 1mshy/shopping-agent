// Which separator in a figure is the decimal point (S§5.2; the owner's ruling of 2026-11-23 on
// "1.299 €"). The answer is a canonical machine decimal ("1299.95"), which `moneyFromDecimal`
// scales exactly; nothing here touches a float.
import type { LocaleSeparators } from '../currency/locale.ts';

export type FigureReading =
  | { readonly ok: true; readonly decimal: string }
  | { readonly ok: false; readonly detail: string };

type Sep = '.' | ',' | "'" | ' ';

function ambiguous(detail: string): FigureReading {
  return { ok: false, detail };
}

/**
 * Reads a figure's digits and separators (as scan.ts found them) into a canonical decimal.
 *
 * - Apostrophes and spaces group thousands.
 * - When both "." and "," occur, the last one is the decimal point.
 * - Commas only: one comma before exactly two digits is a decimal comma; several commas group
 *   thousands. One comma before exactly three digits groups thousands, unless the locale writes
 *   the comma as its decimal point, or the currency has three decimals and the locale does not
 *   settle it. One comma before one digit or four and more is a decimal comma where the locale
 *   writes one, and refused otherwise.
 * - Dots only: several dots group thousands; one dot is the decimal point, except one dot before
 *   exactly three digits in a currency with fewer than three decimals: thousands where the locale
 *   groups with a dot ("1.299 €" on de-DE), the decimal point where the locale writes a decimal
 *   dot, refused when the locale is unclear.
 * - A lone "." or "," is the decimal point when what stands before it cannot be a thousands
 *   group: after an apostrophe or space grouping ("1'234.50"), after more than three digits
 *   ("1299.000") or after a leading zero ("0.299").
 *
 * Thousands groups are checked: the first holds one to three digits and does not start with 0, the
 * last holds three, and the ones between hold three (two are allowed with commas, for the Indian
 * "1,23,456"). All thousands separators in one figure are the same character. Anything else is
 * refused: a misread price is worse than none.
 */
export function readFigure(
  figure: string,
  exponent: number,
  locale: LocaleSeparators | null,
  /** The figure is followed by "<sep>-" ("1.299,-", "49.–"): whole units, `sep` is the decimal mark. */
  wholeUnits: '.' | ',' | null = null,
): FigureReading {
  const compact = figure.replace(/ ([.,]) /g, '$1');
  const groups: string[] = [];
  const seps: Sep[] = [];
  for (const m of compact.matchAll(/\d+|[.,' ]/g)) {
    if (/\d/.test(m[0])) groups.push(m[0]);
    else seps.push(m[0] as Sep);
  }
  if (groups.length !== seps.length + 1) return ambiguous(`cannot read the figure "${figure}"`);
  if (seps.length === 0) return { ok: true, decimal: canonical(groups.join(''), '') };

  const last = seps.length - 1;
  const lastSep = seps[last];
  const tail = groups[last + 1] ?? '';
  const dots = seps.filter((s) => s === '.').length;
  const commas = seps.filter((s) => s === ',').length;
  const spacedOrApostrophe = seps.some((s) => s === ' ' || s === "'");

  let decimalAt = -1; // index into seps of the decimal point, or -1
  if (wholeUnits !== null) {
    if (seps.includes(wholeUnits)) {
      return ambiguous(`"${figure}${wholeUnits}-" marks decimals twice`);
    }
    decimalAt = -1;
  } else if (lastSep === ' ' || lastSep === "'") {
    decimalAt = -1;
  } else if (dots > 0 && commas > 0) {
    decimalAt = last;
  } else if ((lastSep === ',' && commas === 1) || (lastSep === '.' && dots === 1)) {
    const head = groups[0] ?? '';
    if (spacedOrApostrophe || head.length > 3 || head.startsWith('0')) {
      // Thousands are grouped otherwise, or the head is no thousands group ("1299.000", "0.299").
      decimalAt = last;
    } else {
      const choice = loneSeparator(lastSep, tail.length, exponent, locale);
      if (choice === 'ambiguous') {
        return ambiguous(
          `"${figure}": a lone "${lastSep}" could group thousands or mark decimals, and the locale does not say`,
        );
      }
      decimalAt = choice === 'decimal' ? last : -1;
    }
  }

  const integerGroups = decimalAt === -1 ? groups : groups.slice(0, -1);
  const thousands = decimalAt === -1 ? seps : seps.slice(0, -1);
  const fraction = decimalAt === -1 ? '' : tail;
  if (thousands.length > 0) {
    const char = thousands[0];
    if (thousands.some((s) => s !== char)) {
      return ambiguous(`"${figure}" groups thousands with different separators`);
    }
    if (decimalAt !== -1 && char === seps[decimalAt]) {
      return ambiguous(`"${figure}" uses one separator for thousands and decimals`);
    }
    const [first = '', ...rest] = integerGroups;
    if (first.length > 3 || first.startsWith('0')) {
      return ambiguous(`"${figure}" does not group thousands`);
    }
    for (let i = 0; i < rest.length; i += 1) {
      const size = rest[i]?.length ?? 0;
      const isLast = i === rest.length - 1;
      if (!(size === 3 || (!isLast && size === 2 && char === ','))) {
        return ambiguous(`"${figure}" does not group thousands`);
      }
    }
  }
  return { ok: true, decimal: canonical(integerGroups.join(''), fraction) };
}

/** A single "." or "," that ends the figure, before `tailLength` digits. */
function loneSeparator(
  sep: '.' | ',',
  tailLength: number,
  exponent: number,
  locale: LocaleSeparators | null,
): 'decimal' | 'thousands' | 'ambiguous' {
  if (sep === ',') {
    if (tailLength === 2 || locale?.decimal === ',') return 'decimal';
    if (tailLength !== 3) return 'ambiguous'; // "12,5" or "12,3456" with no decimal-comma locale
    if (exponent < 3 || locale?.group === ',') return 'thousands';
    return 'ambiguous';
  }
  if (tailLength !== 3 || exponent >= 3) return 'decimal';
  if (locale?.group === '.') return 'thousands';
  if (locale?.decimal === '.') return 'decimal';
  return 'ambiguous';
}

function canonical(integer: string, fraction: string): string {
  const whole = integer.replace(/^0+(?=\d)/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}
