// The spike A host list (hosts.json) and the URL canonicalisation used to build it.
import { readFileSync } from 'node:fs';

/** What the predecessor recorded about a host, kept to compare its curl_cffi rung with ours. */
export interface Predecessor {
  /** data/fetch_playbook.json: the cheapest rung that last worked on the host, and its date. */
  playbook: { strategy: string; date: string } | null;
  /** The newest price read on this host in the predecessor's reports, and which rung read it. */
  read: {
    rung: 'http' | 'browser' | 'unknown';
    method: string | null;
    report: string;
    date: string;
    /** That read was on the same (canonical) URL as the one probed here. */
    sameUrl: boolean;
  } | null;
  /** Browser lab (2026-10-16): cells that ran the store, and cells that read a price there. */
  lab: { cellsTried: number; cellsWithPrice: number } | null;
}

export interface HostEntry {
  key: string;
  host: string;
  url: string;
  source: 'lab' | 'playbook';
  group: string;
  urlFrom: string;
  predecessor: Predecessor;
}

export interface HostList {
  version: 1;
  built: string;
  predecessor: { path: string; branch: string; commit: string; note: string };
  counts: {
    labStores: number;
    labWithUrl: number;
    playbookHosts: number;
    playbookOutsideLab: number;
    playbookWithUrl: number;
  };
  hosts: HostEntry[];
  excluded: Array<{
    key: string;
    host: string;
    source: 'lab';
    reason: string;
    predecessor: Predecessor;
  }>;
}

/**
 * Query parameters that only record how a page was reached (search position, ad slot,
 * analytics); they are dropped so no search or session token is committed, and so repeated
 * visits to one product count as one URL. Parameters that select the product (variant, sku,
 * colour, language, id) are kept.
 */
const TRACKING = new Set([
  '_su_rec',
  'adSlot',
  'attributionToken',
  'crid',
  'dib',
  'dib_tag',
  'icid',
  'indexName',
  'keywords',
  'listId',
  'objectID',
  'qid',
  'queryID',
  'ref',
  'ref_',
  'rq',
  'search_query',
  'searchclick',
  'searchid',
  'searchuuid',
  'slotPosition',
  'source',
  'sp',
  'sprefix',
  'sr',
  'trk',
  'keyword',
  'pageKey',
  'th',
  'fulfillmentIntent',
  'filters',
  'classType',
  'from',
]);

/** A search-results URL (a store's own search page), which is not a product page. */
export function isSearchUrl(input: string): boolean {
  return /\/(?:search|sch|catalogsearch|search-results)(?:[/.]|$)/i.test(new URL(input).pathname);
}

export function canonicalUrl(input: string): string {
  const u = new URL(input);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING.has(k) || /^utm_/.test(k)) u.searchParams.delete(k);
  }
  // Amazon's "/ref=sr_1_1" path suffix is a search-position marker.
  u.pathname = u.pathname.replace(/\/ref=[^/]*$/, '');
  return u.href;
}

export function readHosts(file = new URL('./hosts.json', import.meta.url)): HostList {
  return JSON.parse(readFileSync(file, 'utf8')) as HostList;
}
