// Retry-After (RFC 9110 §10.2.3): delay-seconds or an HTTP-date (§5.6.7: IMF-fixdate, and the
// obsolete RFC 850 and asctime forms a recipient must accept), as milliseconds from `now`.

const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const LONG_DAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '(\\d{2}):(\\d{2}):(\\d{2})';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Sun, 06 Nov 1994 08:49:37 GMT */
const IMF_FIXDATE = new RegExp(`^${DAY}, (\\d{2}) ${MONTH} (\\d{4}) ${TIME} GMT$`, 'i');
/** Sunday, 06-Nov-94 08:49:37 GMT */
const RFC_850 = new RegExp(`^${LONG_DAY}, (\\d{2})-${MONTH}-(\\d{2}) ${TIME} GMT$`, 'i');
/** Sun Nov  6 08:49:37 1994 */
const ASCTIME = new RegExp(`^${DAY} ${MONTH} ( \\d|\\d{2}) ${TIME} (\\d{4})$`, 'i');

function utc(
  year: number,
  month: string,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  const m = MONTHS.indexOf(month.toLowerCase());
  // A leap second (60) is allowed by the grammar and read as the next second.
  if (m === -1 || day < 1 || hour > 23 || minute > 59 || second > 60) return null;
  const ms = Date.UTC(year, m, day, hour, minute, second);
  return new Date(Date.UTC(year, m, day)).getUTCDate() === day ? ms : null;
}

/** An HTTP-date as epoch milliseconds, or null when it is not one. */
export function parseHttpDate(text: string, now: number): number | null {
  let match = IMF_FIXDATE.exec(text);
  if (match) {
    const [, day, month, year, h, m, s] = match;
    return utc(Number(year), month ?? '', Number(day), Number(h), Number(m), Number(s));
  }
  match = RFC_850.exec(text);
  if (match) {
    const [, day, month, yy, h, m, s] = match;
    // §5.6.7: a two-digit year more than 50 years in the future is the most recent past year
    // with the same last two digits.
    const nowYear = new Date(now).getUTCFullYear();
    let year = nowYear - (nowYear % 100) + Number(yy);
    if (year > nowYear + 50) year -= 100;
    return utc(year, month ?? '', Number(day), Number(h), Number(m), Number(s));
  }
  match = ASCTIME.exec(text);
  if (match) {
    const [, month, day, h, m, s, year] = match;
    return utc(Number(year), month ?? '', Number(day), Number(h), Number(m), Number(s));
  }
  return null;
}

/**
 * The Retry-After delay in milliseconds at `now` (epoch milliseconds): a date in the past is 0.
 * Null when the header is absent or unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1_000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const date = parseHttpDate(text, now);
  if (date === null) return null;
  const ms = Math.ceil(date - now);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, ms);
}
