// Small shared pieces: times, safe external links, money text, messages.
import type { ReactNode } from 'react';
import { formatMoney } from './money.ts';
import { t } from './strings.ts';

/** A timestamp for display in the browser's locale; "never"/"not read yet" is the caller's word. */
export function formatTime(iso: string | null | undefined, empty: string = t.never): string {
  if (iso === null || iso === undefined || iso === '') return empty;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Only http(s) URLs become links. Store text is data: rendered as text, never as HTML. */
export function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

export function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  if (!isHttpUrl(href)) return <span>{children ?? href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children ?? href}
    </a>
  );
}

export interface MoneyLike {
  readonly amountMinor: number;
  readonly currency: string;
}

/** An amount always with its currency; null shows "unknown" rather than a blank or a zero. */
export function MoneyText({
  value,
  empty = t.unknown,
}: {
  value: MoneyLike | null;
  empty?: string;
}) {
  if (value === null) return <span className="muted">{empty}</span>;
  return <span>{formatMoney(value.amountMinor, value.currency)}</span>;
}

export function Message({ kind, text }: { kind: 'error' | 'warn' | 'ok'; text: string | null }) {
  if (text === null || text === '') return null;
  return (
    <p className={`msg ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {text}
    </p>
  );
}
