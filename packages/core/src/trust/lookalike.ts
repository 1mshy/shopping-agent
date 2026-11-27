// S§5.5. A visual similarity is a reason for caution. Its reference must be an
// independently known storefront, which the caller checks against its directory.
// Only these multi-label boundaries are recognised by this conservative local signal.
const COUNTRY_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.jp', 'co.nz']);
const confusables: Readonly<Record<string, readonly string[]>> = {
  '0': ['o'],
  '1': ['i', 'l'],
  '5': ['s'],
  rn: ['m'],
  vv: ['w'],
};

/** Known host spellings to check for exactly one confusable in the merchant's label.
 * Only compare bare domains (or www), with the same suffix. Leave ambiguous subdomains,
 * shared-host tenants, IDNs, short names and ordinary spelling differences unclassified. */
export function lookalikeReferences(hostname: string): string[] {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  const [label, ...suffix] = host.split('.');
  const right = suffix.join('.');
  if (
    !label ||
    label.length < 5 ||
    label.length > 63 ||
    label.startsWith('xn--') ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(label) ||
    (!/^[a-z]{2,63}$/.test(right) && !COUNTRY_SUFFIXES.has(right))
  )
    return [];
  const result = new Set<string>();
  for (const [pattern, replacements] of Object.entries(confusables)) {
    for (let at = label.indexOf(pattern); at !== -1; at = label.indexOf(pattern, at + 1)) {
      for (const replacement of replacements) {
        const name = label.slice(0, at) + replacement + label.slice(at + pattern.length);
        result.add(`${name}.${right}`);
        result.add(`www.${name}.${right}`);
      }
    }
  }
  return [...result];
}
