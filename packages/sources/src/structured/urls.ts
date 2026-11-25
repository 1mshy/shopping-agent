// URL comparison for variant coupling (S§5.2). URLs from the page are only parsed and compared:
// nothing here fetches or follows one (S§2.7).

/** Query parameters that name a variant on the platforms we read (Shopify `variant`, `id`, `sku`…). */
const VARIANT_PARAMS = new Set([
  'variant',
  'variant_id',
  'variantid',
  'id',
  'sku',
  'skuid',
  'sku_id',
  'pid',
]);

export function parseUrl(raw: string, base: string): URL | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = base === '' ? new URL(raw.trim()) : new URL(raw.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostKey(url: URL): string {
  const h = url.hostname.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function pathKey(url: URL): string {
  const p = url.pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Same storefront page: host (without www.) and path (without a trailing slash). Query ignored. */
export function samePage(a: URL, b: string | URL): boolean {
  const other = typeof b === 'string' ? parseUrl(b, '') : b;
  return other !== null && hostKey(a) === hostKey(other) && pathKey(a) === pathKey(other);
}

/** A comparable form of a URL: host, path and sorted query, no fragment. */
export function urlKey(url: URL): string {
  const params = [...url.searchParams].map(([k, v]) => `${k}=${v}`).sort();
  return `${hostKey(url)}${pathKey(url)}?${params.join('&')}`;
}

/** The values of the variant-naming parameters of a URL ("?variant=42" → ["42"]). */
export function variantHints(url: URL | null): string[] {
  if (url === null) return [];
  const out: string[] = [];
  for (const [k, v] of url.searchParams) {
    const value = v.trim();
    if (VARIANT_PARAMS.has(k.toLowerCase()) && value !== '' && !out.includes(value))
      out.push(value);
  }
  return out;
}

/** True when `unit` is the same page as `target` and every query parameter of `unit` is in `target`. */
export function within(unit: URL, target: URL): boolean {
  if (!samePage(unit, target)) return false;
  for (const [k, v] of unit.searchParams) {
    if (!target.searchParams.getAll(k).includes(v)) return false;
  }
  return true;
}
