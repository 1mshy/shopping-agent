// IP-literal hosts: every range S§5.1 names, in IPv4 and IPv6 spellings, plus the ranges the
// predecessor also refused. No lookup is needed for a literal.

import type { Rung } from '@agentic-dasher/shared';
import type { GuardCase, GuardDecision } from '../contract.ts';

const NETGUARD_LITERALS =
  'pricewatch/tests/test_netguard.py::test_private_and_special_literals_are_blocked (BLOCKED_LITERALS); ' +
  'netguard.py blocked_address lines 48-59';
const PRIVATE_URLS =
  'pricewatch/tests/test_fetch_private.py::test_a_private_url_is_refused_before_any_request';

function refused(rung: Rung = 'http'): GuardDecision {
  return { pass: false, outcome: { kind: 'refused_by_policy', rung, reason: 'private_address' } };
}

const ENCODED =
  'Added for the "encoded addresses" class: the predecessor never tested this spelling, so the ' +
  "expectation is the spec's. Node's URL parser canonicalises the host to 127.0.0.1 (checked); " +
  'the predecessor saw a name, and with the scripted answer (127.0.0.1, as glibc reads it) its ' +
  'refuse_private refuses too (ran). Its real answer depended on the system resolver.';

const OUTSIDE_THE_FIVE =
  'S§5.1 and the shared vocabulary name five refused ranges (private, loopback, link-local, CGNAT, ' +
  'metadata) and give them one reason, `private_address`. This range is none of the five; ' +
  '`private_address` is used as the closest value.';

export const literalCases: readonly GuardCase[] = [
  {
    id: 'loopback-ipv4-literal-is-refused',
    what: "127.0.0.1 (the app's own API) is refused",
    input: { url: 'http://127.0.0.1:8000/api/trackers', rung: 'http', answer: null },
    expected: refused(),
    from: `${PRIVATE_URLS}; ${NETGUARD_LITERALS}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'loopback-ipv6-literal-is-refused',
    what: '[::1] is refused',
    input: { url: 'http://[::1]:8000/', rung: 'http', answer: null },
    expected: refused(),
    from: `${PRIVATE_URLS}; ${NETGUARD_LITERALS}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'private-10-literal-is-refused-before-the-browser-starts',
    what: 'A 10/8 address (a LAN model server) is refused, on the browser rung too',
    input: { url: 'http://10.0.0.30:1234/v1/models', rung: 'browser', answer: null },
    expected: refused('browser'),
    from: `${PRIVATE_URLS}; test_fetch_private.py::test_render_refuses_a_private_url_up_front; ${NETGUARD_LITERALS}`,
    established: ['test', 'ran', 'spec'],
    note: "The predecessor's tests used the owner's LAN address; 10.0.0.30 stands in for it.",
  },
  {
    id: 'private-172-16-literal-is-refused',
    what: 'A 172.16/12 address is refused',
    input: { url: 'http://172.16.9.9/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'private-192-168-literal-is-refused',
    what: 'A 192.168/16 address (a home router) is refused',
    input: { url: 'http://192.168.1.1/', rung: 'http', answer: null },
    expected: refused(),
    from: `${PRIVATE_URLS}; ${NETGUARD_LITERALS}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'cloud-metadata-literal-is-refused',
    what: 'The cloud metadata address 169.254.169.254 is refused',
    input: { url: 'http://169.254.169.254/latest/meta-data/', rung: 'http', answer: null },
    expected: refused(),
    from: `${PRIVATE_URLS}; ${NETGUARD_LITERALS}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'link-local-ipv4-literal-is-refused',
    what: 'Another 169.254/16 address is refused',
    input: { url: 'http://169.254.0.1/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'cgnat-literal-is-refused',
    what: 'A 100.64/10 (CGNAT) address is refused',
    input: { url: 'http://100.64.0.1/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'ipv4-mapped-loopback-is-refused',
    what: '[::ffff:127.0.0.1] is judged as the IPv4 address it carries',
    input: { url: 'http://[::ffff:127.0.0.1]:8000/', rung: 'http', answer: null },
    expected: refused(),
    from: `${PRIVATE_URLS}; ${NETGUARD_LITERALS}; test_netguard.py::test_plain_http_to_a_private_destination_is_refused`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'ipv4-mapped-private-is-refused',
    what: '[::ffff:10.0.0.30] is judged as the IPv4 address it carries',
    input: { url: 'http://[::ffff:10.0.0.30]/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'ipv6-link-local-literal-is-refused',
    what: '[fe80::1] is refused',
    input: { url: 'http://[fe80::1]/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'ipv6-metadata-address-is-refused',
    what: 'The IPv6 cloud metadata address fd00:ec2::254 (unique local) is refused',
    input: { url: 'http://[fd00:ec2::254]/', rung: 'http', answer: null },
    expected: refused(),
    from: 'netguard.py blocked_address lines 48-59 (not is_global), run offline',
    established: ['ran', 'spec'],
    note: 'No predecessor test. S§5.1 names metadata ranges; this is the IPv6 one, inside fc00::/7.',
  },
  {
    id: 'decimal-ipv4-spelling-of-loopback-is-refused',
    what: 'http://2130706433/ is 127.0.0.1 written as one number',
    input: {
      url: 'http://2130706433:9119/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['127.0.0.1'] },
    },
    expected: refused(),
    from: 'pricewatch/tests/test_netguard.py::test_plain_http_to_a_private_destination_is_refused',
    established: ['test', 'spec'],
    note:
      'The predecessor saw a name and its stubbed resolver answered 127.0.0.1 ("glibc reads ' +
      "'2130706433' as 127.0.0.1; Chrome canonicalises it first\"). The WHATWG URL parser " +
      'canonicalises it to 127.0.0.1 without a lookup. Either path must refuse; the answer is given ' +
      'for a guard that does look it up.',
  },
  {
    id: 'hex-ipv4-spelling-of-loopback-is-refused',
    what: 'http://0x7f000001/ is 127.0.0.1 in hexadecimal',
    input: {
      url: 'http://0x7f000001/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['127.0.0.1'] },
    },
    expected: refused(),
    from: "S§5.1 (loopback refused); not in the predecessor's tests",
    established: ['spec', 'ran'],
    note: ENCODED,
  },
  {
    id: 'octal-ipv4-spelling-of-loopback-is-refused',
    what: 'http://0177.0.0.1/ is 127.0.0.1 with an octal first part',
    input: {
      url: 'http://0177.0.0.1/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['127.0.0.1'] },
    },
    expected: refused(),
    from: "S§5.1 (loopback refused); not in the predecessor's tests",
    established: ['spec', 'ran'],
    note: ENCODED,
  },
  {
    id: 'short-ipv4-spelling-of-loopback-is-refused',
    what: 'http://127.1/ is 127.0.0.1 with its middle parts left out',
    input: {
      url: 'http://127.1/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['127.0.0.1'] },
    },
    expected: refused(),
    from: "S§5.1 (loopback refused); not in the predecessor's tests",
    established: ['spec', 'ran'],
    note: ENCODED,
  },
  {
    id: 'unspecified-address-is-refused',
    what: '0.0.0.0, which reaches the local host on Linux and macOS, is refused',
    input: { url: 'http://0.0.0.0:8000/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran'],
    specSilent: true,
    gap: OUTSIDE_THE_FIVE,
  },
  {
    id: 'multicast-address-is-refused',
    what: 'A multicast address is refused',
    input: { url: 'http://224.0.0.1/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran'],
    specSilent: true,
    gap: OUTSIDE_THE_FIVE,
  },
  {
    id: 'documentation-range-is-refused',
    what: 'A documentation-range address (198.51.100.0/24) is refused',
    input: { url: 'http://198.51.100.7/', rung: 'http', answer: null },
    expected: refused(),
    from: 'netguard.py blocked_address lines 48-59 (anything not is_global), run offline',
    established: ['read', 'ran'],
    specSilent: true,
    gap: OUTSIDE_THE_FIVE,
    note:
      'The predecessor refuses every address that is not public global unicast: reserved, ' +
      'documentation, benchmarking, broadcast and unspecified ranges as well as the five. One case ' +
      'stands for those classes. It is why no case uses a documentation address as "public".',
  },
  {
    id: 'nat64-of-loopback-is-refused',
    what: '64:ff9b::7f00:1 (NAT64 of 127.0.0.1) is judged as the IPv4 address it reaches',
    input: { url: 'http://[64:ff9b::7f00:1]/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran'],
    specSilent: true,
  },
  {
    id: 'nat64-of-private-is-refused',
    what: '64:ff9b::a00:1e (NAT64 of 10.0.0.30) is judged as the IPv4 address it reaches',
    input: { url: 'http://[64:ff9b::a00:1e]/', rung: 'http', answer: null },
    expected: refused(),
    from: NETGUARD_LITERALS,
    established: ['test', 'ran'],
    specSilent: true,
    note: 'The predecessor tested 64:ff9b::a96:1e (its LAN address); this is the same form for 10.0.0.30.',
  },
  {
    id: 'nat64-of-public-passes',
    what: '64:ff9b::101:101 (NAT64 of 1.1.1.1) passes',
    input: { url: 'http://[64:ff9b::101:101]/', rung: 'http', answer: null },
    expected: { pass: true, connectTo: ['64:ff9b::101:101'] },
    from: 'pricewatch/tests/test_netguard.py::test_public_literals_are_allowed (ALLOWED_LITERALS)',
    established: ['test', 'ran'],
    specSilent: true,
  },
  {
    id: 'public-ipv4-literal-passes',
    what: 'A public IPv4 literal passes and connects to itself',
    input: { url: 'http://1.1.1.1/', rung: 'http', answer: null },
    expected: { pass: true, connectTo: ['1.1.1.1'] },
    from: 'pricewatch/tests/test_netguard.py::test_public_literals_are_allowed (ALLOWED_LITERALS)',
    established: ['test', 'ran'],
  },
  {
    id: 'public-ipv6-literal-passes',
    what: 'A public IPv6 literal passes and connects to itself',
    input: { url: 'http://[2606:4700:4700::1111]/', rung: 'http', answer: null },
    expected: { pass: true, connectTo: ['2606:4700:4700::1111'] },
    from: 'pricewatch/tests/test_netguard.py::test_public_literals_are_allowed (ALLOWED_LITERALS)',
    established: ['test', 'ran'],
  },
  {
    id: 'userinfo-naming-a-store-before-a-loopback-host-is-refused',
    what: 'In http://www.store.example@127.0.0.1/ the host is 127.0.0.1, and it is refused',
    input: { url: 'http://www.store.example@127.0.0.1/', rung: 'http', answer: null },
    expected: refused(),
    from: 'fetch.py refuse_private lines 131-153 (urlsplit hostname), run offline',
    established: ['ran', 'spec'],
    note: 'No predecessor test of user-info.',
  },
  {
    id: 'credentials-before-a-private-host-are-refused',
    what: 'In http://user:secret@10.0.0.5:8080/ the host is 10.0.0.5, and it is refused',
    input: { url: 'http://user:secret@10.0.0.5:8080/', rung: 'http', answer: null },
    expected: refused(),
    from: 'fetch.py refuse_private lines 131-153, run offline',
    established: ['ran', 'spec'],
    note: 'No predecessor test of user-info. "secret" is a placeholder.',
  },
];
