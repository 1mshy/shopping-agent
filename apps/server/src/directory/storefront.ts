// A Shopify Markets locale segment at the start of a path, when more path follows it.
const MARKET_PREFIX = /^\/([a-z]{2}(?:-[a-z]{2})?)\/[^/?#]/i;

export function marketPrefixOf(pathname: string): string {
  const m = MARKET_PREFIX.exec(pathname);
  return m?.[1] === undefined ? '' : `/${m[1].toLowerCase()}`;
}
