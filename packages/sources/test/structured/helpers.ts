// Shared test inputs for the structured-data readers and the ladder. No network: every page is a
// fixture file or a string, wrapped as the PageResponse fetchPage would have produced.
import { readFileSync } from 'node:fs';
import type { PageResponse } from '@agentic-dasher/fetch';
import type {
  ListingRead,
  Market,
  ReaderOutcome,
  ReadRequest,
  StoreHints,
  VariantSelector,
} from '../../src/read/contract.ts';

export const CA: Market = { country: 'CA', currency: 'CAD', language: 'en' };

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function page(html: string, finalUrl: string, status = 200): PageResponse {
  return {
    status,
    finalUrl,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    setCookies: [],
    contentType: 'text/html; charset=utf-8',
    body: new TextEncoder().encode(html),
    text: html,
  };
}

export function request(
  url: string,
  variant: VariantSelector | null = null,
  store: StoreHints | null = null,
  market: Market = CA,
): ReadRequest {
  return { url, market, store, variant };
}

/** An HTML page around JSON-LD blocks, given as values (serialised here) or raw text. */
export function ldPage(...blocks: (string | object)[]): string {
  const scripts = blocks
    .map(
      (b) =>
        `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html lang="en"><head><title>Test page</title>${scripts}</head><body></body></html>`;
}

export function expectRead(outcome: ReaderOutcome): ListingRead {
  if (outcome.kind !== 'read') {
    throw new Error(`expected a read, got ${JSON.stringify(outcome)}`);
  }
  return outcome.read;
}

export function expectNoRead(outcome: ReaderOutcome) {
  if (outcome.kind !== 'no_read') {
    throw new Error(`expected no_read, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

export function values(candidates: readonly { readonly value: string }[]): string[] {
  return candidates.map((c) => c.value);
}
