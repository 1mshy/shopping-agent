// The http/https clause: what is a web address at all, before any lookup.
import type { GuardCase, GuardDecision } from '../contract.ts';

const NOT_WEB =
  'pricewatch/tests/test_fetch_private.py::test_a_url_that_is_not_a_web_page_never_reaches_a_transport ' +
  'and ::test_the_scheme_check_holds_with_the_address_check_on_too (NOT_WEB list); ' +
  'fetch.py web_url_problem lines 114-128';

const scheme: GuardDecision = {
  pass: false,
  outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'scheme' },
};

function notWeb(id: string, what: string, url: string): GuardCase {
  return {
    id,
    what,
    input: { url, rung: 'http', answer: null },
    expected: scheme,
    from: NOT_WEB,
    established: ['test', 'ran', 'spec'],
  };
}

const urlForm: GuardDecision = {
  pass: false,
  outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'url_form' },
};

const NO_HOST =
  'Refused as `url_form`: a URL unacceptable as written (user-info, no host) gets its own refusal ' +
  'reason instead of `scheme` (settled by the orchestrator 2026-11-23, the owner may overrule; ' +
  'docs/progress.md). Until then this case used `scheme` as the closest value. The predecessor ' +
  'refused it under the same error as a non-web scheme (NotAWebPage).';

export const urlFormCases: readonly GuardCase[] = [
  notWeb('file-url-is-refused', 'A file: URL is refused', 'file:///etc/hostname'),
  notWeb(
    'file-url-in-capitals-is-refused',
    'The scheme check ignores case',
    'FILE:///etc/hostname',
  ),
  notWeb(
    'file-url-naming-a-host-is-refused',
    'A file: URL is refused even when it names a host',
    'file://localhost/etc/hostname',
  ),
  notWeb('dict-url-is-refused', 'A dict: URL is refused', 'dict://store.example:2628/d:price'),
  notWeb('ftp-url-is-refused', 'An ftp: URL is refused', 'ftp://store.example/price.txt'),
  notWeb('gopher-url-is-refused', 'A gopher: URL is refused', 'gopher://store.example:70/_GET'),
  notWeb('data-url-is-refused', 'A data: URL is refused', 'data:text/html,<p>$1.00</p>'),
  notWeb('javascript-url-is-refused', 'A javascript: URL is refused', 'javascript:alert(1)'),
  notWeb('chrome-url-is-refused', 'A chrome: URL is refused', 'chrome://version'),
  notWeb('absolute-path-is-refused', 'A path with no scheme is refused', '/etc/hostname'),
  notWeb('relative-path-is-refused', 'A relative path is refused', 'etc/hostname'),
  notWeb(
    'host-without-a-scheme-is-refused',
    'A host and path with no scheme is refused, not guessed to be http',
    'www.store.example/p/1',
  ),
  notWeb('empty-url-is-refused', 'An empty URL is refused', ''),
  {
    ...notWeb(
      'https-url-without-a-host-is-refused',
      'An https URL whose authority is empty is refused',
      'https:///p/1',
    ),
    expected: urlForm,
    established: ['test', 'ran', 'spec', 'ruling'],
    note:
      `${NO_HOST} The WHATWG URL parser (Node's URL) reads "https:///p/1" as host "p", path "/1"; ` +
      'the predecessor (urlsplit) saw no host. A guard that only parses with URL fails this case: it ' +
      'must refuse an empty authority in the text as written.',
  },
  {
    ...notWeb('http-scheme-alone-is-refused', 'The bare string "http://" is refused', 'http://'),
    expected: urlForm,
    established: ['test', 'ran', 'spec', 'ruling'],
    note: NO_HOST,
  },
  {
    id: 'https-store-url-passes',
    what: 'A public store URL passes with the address its name resolved to',
    input: {
      url: 'https://www.store.example/p/1',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['93.184.215.14'] },
    },
    expected: { pass: true, connectTo: ['93.184.215.14'] },
    from:
      'pricewatch/tests/test_fetch_private.py::test_a_public_store_reads_as_before and ' +
      '::test_web_pages_pass_the_scheme_check',
    established: ['test', 'ran'],
    note: '93.184.215.14 is the IANA example.com address the predecessor\'s tests use as "public".',
  },
  {
    id: 'upper-case-scheme-and-another-port-pass',
    what: 'An upper-case HTTP scheme and a non-default port pass',
    input: {
      url: 'HTTP://store.example:8443/p?x=1',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['93.184.215.14'] },
    },
    expected: { pass: true, connectTo: ['93.184.215.14'] },
    from: 'pricewatch/tests/test_fetch_private.py::test_web_pages_pass_the_scheme_check',
    established: ['test', 'ran'],
    note: 'The predecessor restricts no port; S§5.1 names none.',
  },
  {
    id: 'public-ipv6-literal-passes-as-the-bare-address',
    what: 'A public IPv6 literal passes without a lookup and connects to the bare address',
    input: { url: 'http://[2606:2800:220:1::]/p', rung: 'http', answer: null },
    expected: { pass: true, connectTo: ['2606:2800:220:1::'] },
    from:
      'pricewatch/tests/test_fetch_private.py::test_web_pages_pass_the_scheme_check; ' +
      'test_netguard.py::test_a_public_ipv6_literal_connects_to_the_bare_address',
    established: ['test', 'ran'],
  },
];
