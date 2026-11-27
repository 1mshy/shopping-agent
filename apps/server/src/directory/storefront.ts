// A Shopify Markets locale segment at the start of a path, when more path follows it.
const MARKET_PREFIX = /^\/([a-z]{2}(?:-[a-z]{2})?)\/[^/?#]/i;

export function marketPrefixOf(pathname: string): string {
  const m = MARKET_PREFIX.exec(pathname);
  return m?.[1] === undefined ? '' : `/${m[1].toLowerCase()}`;
}

/** Platform evidence inferred by a directory inspection may be refreshed at expiry. */
export function fingerprintPlatformEvidence(evidence: string | null): boolean {
  return (
    evidence === 'home_markup' ||
    evidence === 'shopify_suggest' ||
    evidence === 'woo_store_api' ||
    evidence === 'magento_graphql'
  );
}

export function directPlatformEvidence(origin: string): string {
  return `direct_read ${origin}`;
}
