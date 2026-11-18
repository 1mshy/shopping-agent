// Pinning, per-hop redirect checks and connection failures, on a scripted network.
import type { DnsAnswer, TransportCase } from '../contract.ts';

/** IANA's example.com addresses: public, and what the predecessor's tests used as public. */
const PUBLIC = '93.184.215.14';
const PUBLIC6 = '2606:2800:220:1:248:1893:25c8:1946';
/** Stands in for the owner's LAN model server in the predecessor's tests. */
const PRIVATE = '10.0.0.30';

const at = (...addresses: string[]): DnsAnswer => ({ kind: 'addresses', addresses });
const page = { status: 200, bodyBytes: 5000 } as const;
const redirect = (location: string) => ({ status: 302, location, bodyBytes: 0 }) as const;

const PER_HOP_DIVERGENCE =
  'The predecessor let curl_cffi (or httpx) follow redirects by itself and checked only the URL ' +
  'the chain landed on, after the request had gone (fetch.py _refuse_private_landing, lines ' +
  '171-181, called from Fetcher.get lines 728 and 739). S§5.1: every redirect is re-checked, so a ' +
  'refused hop is never requested.';

export const transportCases: readonly TransportCase[] = [
  {
    id: 'rebinding-answer-after-the-check-is-never-dialled',
    what: 'A name that answers public for the check and private afterwards is resolved once; the public address is dialled',
    input: {
      request: { url: 'https://store.example/p/1', rung: 'http' },
      network: {
        dns: { 'store.example': [at(PUBLIC), at(PRIVATE)] },
        responses: { 'https://store.example/p/1': page },
        unreachable: [],
      },
    },
    expected: {
      result: { delivered: true, finalUrl: 'https://store.example/p/1', status: 200 },
      lookups: ['store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://store.example/p/1' }],
    },
    from:
      'pricewatch/tests/test_netguard.py::test_connect_to_a_vetted_destination_is_tunnelled ' +
      '(resolved once, connected to what it checked); netguard.py docstring lines 12-16; ' +
      'fetch.py refuse_private lines 131-153 and Fetcher.get / _get_cffi lines 705-728',
    established: ['test', 'read', 'spec'],
    divergence:
      'On the HTTP rung the predecessor checked the name in refuse_private and then let curl_cffi ' +
      'resolve it again to connect, so an answer that changed in between was dialled. Only its ' +
      'browser proxy (netguard) pinned the vetted address. S§5.1 pins every connection.',
  },
  {
    id: 'rebinding-answer-is-never-dialled-on-the-browser-rung',
    what: "The browser's requests are pinned the same way",
    input: {
      request: { url: 'https://store.example/p/1', rung: 'browser' },
      network: {
        dns: { 'store.example': [at(PUBLIC), at(PRIVATE)] },
        responses: { 'https://store.example/p/1': page },
        unreachable: [],
      },
    },
    expected: {
      result: { delivered: true, finalUrl: 'https://store.example/p/1', status: 200 },
      lookups: ['store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://store.example/p/1' }],
    },
    from:
      'pricewatch/tests/test_netguard.py::test_connect_to_a_vetted_destination_is_tunnelled; ' +
      'S§5.1 ("The browser\'s egress goes through a filtering proxy in the core with the same rules")',
    established: ['test', 'spec'],
    note: 'The predecessor test used 127.0.0.1 as the allowed first answer (its upstream was local).',
  },
  {
    id: 'private-literal-is-never-dialled',
    what: 'A private IP-literal URL is refused with no lookup and no connection',
    input: {
      request: { url: `http://${PRIVATE}:1234/v1/models`, rung: 'http' },
      network: { dns: {}, responses: {}, unreachable: [] },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
      },
      lookups: [],
      exchanges: [],
    },
    from:
      'pricewatch/tests/test_netguard.py::test_connect_to_a_private_destination_is_refused_without_connecting; ' +
      'test_fetch_private.py::test_a_private_url_is_refused_before_any_request (requested == [])',
    established: ['test', 'spec'],
  },
  {
    id: 'private-name-is-never-dialled',
    what: 'A name resolving to a private address is refused after the lookup, with no connection',
    input: {
      request: { url: 'http://engine:8000/api/trackers', rung: 'http' },
      network: { dns: { engine: [at('172.18.0.4')] }, responses: {}, unreachable: [] },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
      },
      lookups: ['engine'],
      exchanges: [],
    },
    from:
      'pricewatch/tests/test_netguard.py::test_connect_to_a_private_destination_is_refused_without_connecting ' +
      '("pricewatch:8000"); test_fetch_private.py::test_get_or_render_does_not_climb_to_the_browser_for_a_private_url',
    established: ['test', 'spec'],
    note: "The predecessor's service name and compose subnet are replaced by fictional ones.",
  },
  {
    id: 'public-redirect-chain-is-followed-with-every-hop-resolved',
    what: 'A redirect to another public host is followed; each hop is resolved and dialled at its own address',
    input: {
      request: { url: 'https://store.example/go', rung: 'http' },
      network: {
        dns: { 'store.example': [at(PUBLIC)], 'www.store.example': [at(PUBLIC6)] },
        responses: {
          'https://store.example/go': {
            status: 301,
            location: 'https://www.store.example/p/1',
            bodyBytes: 0,
          },
          'https://www.store.example/p/1': page,
        },
        unreachable: [],
      },
    },
    expected: {
      result: { delivered: true, finalUrl: 'https://www.store.example/p/1', status: 200 },
      lookups: ['store.example', 'www.store.example'],
      exchanges: [
        { address: PUBLIC, port: 443, url: 'https://store.example/go' },
        { address: PUBLIC6, port: 443, url: 'https://www.store.example/p/1' },
      ],
    },
    from:
      'fetch.py Fetcher.client (follow_redirects=True, line 679), _get_cffi (allow_redirects=True, ' +
      'line 710), _refuse_private_landing lines 171-181',
    established: ['read', 'spec'],
  },
  {
    id: 'redirect-to-a-private-literal-is-refused-before-it-is-followed',
    what: 'A store redirecting to a private address is refused at that hop, which is never requested',
    input: {
      request: { url: 'https://www.store.example/go', rung: 'http' },
      network: {
        dns: { 'www.store.example': [at(PUBLIC)] },
        responses: {
          'https://www.store.example/go': redirect(`http://${PRIVATE}:1234/v1/models`),
          [`http://${PRIVATE}:1234/v1/models`]: { status: 200, bodyBytes: 2 },
        },
        unreachable: [],
      },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
      },
      lookups: ['www.store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://www.store.example/go' }],
    },
    from:
      'pricewatch/tests/test_fetch_private.py::test_a_redirect_that_lands_on_a_private_address_returns_nothing ' +
      '(refused, and not retried by the second client)',
    established: ['test', 'read', 'spec'],
    divergence: PER_HOP_DIVERGENCE,
  },
  {
    id: 'redirect-to-a-name-that-resolves-private-is-refused-before-it-is-followed',
    what: 'A redirect to another host whose name resolves to a private address is refused at that hop',
    input: {
      request: { url: 'https://www.store.example/go', rung: 'http' },
      network: {
        dns: {
          'www.store.example': [at(PUBLIC)],
          'internal.store.example': [at('192.168.1.20')],
        },
        responses: {
          'https://www.store.example/go': redirect('http://internal.store.example/admin'),
          'http://internal.store.example/admin': page,
        },
        unreachable: [],
      },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
      },
      lookups: ['www.store.example', 'internal.store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://www.store.example/go' }],
    },
    from: 'fetch.py _refuse_private_landing lines 171-181 (another host: refuse_private on the landing URL)',
    established: ['read', 'spec'],
    divergence: PER_HOP_DIVERGENCE,
  },
  {
    id: 'private-hop-inside-a-chain-is-refused',
    what: 'A chain that passes through a private address and lands back on a public page is refused',
    input: {
      request: { url: 'https://store.example/go', rung: 'http' },
      network: {
        dns: { 'store.example': [at(PUBLIC)], 'www.store.example': [at(PUBLIC)] },
        responses: {
          'https://store.example/go': redirect(`http://${PRIVATE}/bounce`),
          [`http://${PRIVATE}/bounce`]: redirect('https://www.store.example/p/1'),
          'https://www.store.example/p/1': page,
        },
        unreachable: [],
      },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
      },
      lookups: ['store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://store.example/go' }],
    },
    from: 'fetch.py _refuse_private_landing lines 171-181 (only the landing URL is checked)',
    established: ['read', 'spec'],
    divergence:
      `${PER_HOP_DIVERGENCE} Here the predecessor would have requested the private hop and then ` +
      'returned the public page it landed on: no refusal at all.',
  },
  {
    id: 'redirect-to-another-scheme-is-not-followed',
    what: 'A redirect to an ftp: URL is refused and not followed',
    input: {
      request: { url: 'https://www.store.example/go', rung: 'http' },
      network: {
        dns: { 'www.store.example': [at(PUBLIC)] },
        responses: { 'https://www.store.example/go': redirect('ftp://store.example/price.txt') },
        unreachable: [],
      },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'scheme' },
      },
      lookups: ['www.store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://www.store.example/go' }],
    },
    from:
      'pricewatch/tests/test_fetch_private.py::test_a_redirect_to_another_scheme_returns_nothing and ' +
      '::test_curl_is_held_to_http_and_https_for_requests_and_redirects',
    established: ['test', 'read', 'spec'],
  },
  {
    id: 'upstream-that-does-not-answer-is-a-network-error',
    what: 'A vetted address that refuses the connection is a network error, not a wall or a refusal',
    input: {
      request: { url: 'https://store.example/p/1', rung: 'http' },
      network: {
        dns: { 'store.example': [at(PUBLIC)] },
        responses: { 'https://store.example/p/1': page },
        unreachable: [PUBLIC],
      },
    },
    expected: {
      result: {
        delivered: false,
        outcome: { kind: 'network_error', rung: 'http', code: 'ECONNREFUSED' },
      },
      lookups: ['store.example'],
      exchanges: [{ address: PUBLIC, port: 443, url: 'https://store.example/p/1' }],
    },
    from:
      'pricewatch/tests/test_netguard.py::test_an_upstream_that_does_not_answer_is_a_502 ' +
      '(502 "upstream unreachable", not the 403 of a refusal)',
    established: ['test', 'spec'],
    note: 'The code is the one the scripted net rejects with, as Node reports a refused connection.',
  },
  {
    id: 'second-vetted-address-is-tried-when-the-first-does-not-answer',
    what: 'When the first vetted address refuses, the next vetted one is dialled, without a new lookup',
    input: {
      request: { url: 'https://dual.example/p/1', rung: 'http' },
      network: {
        dns: { 'dual.example': [at(PUBLIC, PUBLIC6), at(PRIVATE)] },
        responses: { 'https://dual.example/p/1': page },
        unreachable: [PUBLIC],
      },
    },
    expected: {
      result: { delivered: true, finalUrl: 'https://dual.example/p/1', status: 200 },
      lookups: ['dual.example'],
      exchanges: [
        { address: PUBLIC, port: 443, url: 'https://dual.example/p/1' },
        { address: PUBLIC6, port: 443, url: 'https://dual.example/p/1' },
      ],
    },
    from: 'netguard.py _open lines 180-189 ("Connect to the first vetted address that answers")',
    established: ['read'],
    specSilent: true,
    note: 'A second lookup would get the private answer; the case shows the retry stays pinned.',
  },
];
