// Host names: the guard judges every address the resolver answered (S§5.1 "DNS resolved").
import type { GuardCase, GuardDecision } from '../contract.ts';

const refused: GuardDecision = {
  pass: false,
  outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
};
const NAMES =
  'pricewatch/tests/test_fetch_private.py::test_a_private_url_is_refused_before_any_request; ' +
  'test_netguard.py::test_internal_names_resolve_to_private';

export const nameCases: readonly GuardCase[] = [
  {
    id: 'service-name-resolving-private-is-refused',
    what: "A compose service name (the app's own API) resolving to a private address is refused",
    input: {
      url: 'http://engine:8000/api/notify',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['172.18.0.4'] },
    },
    expected: refused,
    from: NAMES,
    established: ['test', 'ran', 'spec'],
    note: "The predecessor's service names and compose subnet are replaced by fictional ones.",
  },
  {
    id: 'docker-host-name-is-refused',
    what: 'host.docker.internal, which reaches the machine running the containers, is refused',
    input: {
      url: 'http://host.docker.internal:8077/api/price?url=x',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['192.168.65.254'] },
    },
    expected: refused,
    from: NAMES,
    established: ['test', 'ran', 'spec'],
    note: "192.168.65.254 is Docker Desktop's default host address, not the owner's network.",
  },
  {
    id: 'public-name-for-a-private-address-is-refused',
    what: 'A public wildcard-DNS name that answers a private address is refused',
    input: {
      url: 'http://10-0-0-30.nip.io:1234/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['10.0.0.30'] },
    },
    expected: refused,
    from: 'pricewatch/tests/test_fetch_private.py::test_a_private_url_is_refused_before_any_request',
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'name-with-any-private-answer-is-refused',
    what: 'A name answering one public and one private address is refused outright',
    input: {
      url: 'https://split.example/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['93.184.215.14', '10.0.0.30'] },
    },
    expected: refused,
    from:
      'pricewatch/tests/test_netguard.py::test_a_name_with_any_private_answer_is_blocked; ' +
      'netguard.py _vet_infos lines 71-87 ("every answer must be public, or none is used")',
    established: ['test', 'ran', 'spec'],
    note: 'Not "use the public one": a mixed answer is how a rebinding name looks.',
  },
  {
    id: 'scoped-link-local-answer-is-refused',
    what: 'A name answering a scoped IPv6 link-local address (fe80::1%en0) is refused',
    input: {
      url: 'https://scoped.example/',
      rung: 'http',
      answer: { kind: 'addresses', addresses: ['fe80::1%en0'] },
    },
    expected: refused,
    from: 'netguard.py _vet_infos lines 76-79 (an answer that does not parse as an address is refused), run offline',
    established: ['read', 'ran', 'spec'],
  },
  {
    id: 'name-with-public-ipv4-and-ipv6-answers-passes',
    what: 'A name whose answers are all public passes with every answer, IPv4 first',
    input: {
      url: 'https://dual.example/',
      rung: 'http',
      answer: {
        kind: 'addresses',
        addresses: ['93.184.215.14', '2606:2800:220:1:248:1893:25c8:1946'],
      },
    },
    expected: { pass: true, connectTo: ['93.184.215.14', '2606:2800:220:1:248:1893:25c8:1946'] },
    from: 'netguard.py _vet_infos lines 71-87 and resolve lines 90-105, run offline',
    established: ['read', 'ran', 'spec'],
    note:
      'The predecessor de-duplicates and puts IPv4 first ("the containers egress over it"); the ' +
      'answer here is already in that order, so the case does not test the ordering.',
  },
  {
    id: 'userinfo-in-a-url-is-refused',
    what: 'A URL that carries user-info is refused, whatever host follows the @',
    input: {
      url: 'http://127.0.0.1@www.store.example/p/1',
      rung: 'http',
      answer: null,
    },
    expected: {
      pass: false,
      outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'scheme' },
    },
    from: 'fetch.py refuse_private lines 131-153 (urlsplit hostname), run offline',
    established: ['ran', 'spec'],
    divergence:
      'The predecessor took the host after the @ (the store) and let the URL through; no predecessor ' +
      'test covers user-info. The orchestrator set this case to a refusal on 2026-11-18: URL parsers ' +
      'disagree about user-info, and a guard and a transport that read the host differently is the ' +
      'classic way past an address check (S§5.15). No shop link needs credentials in the URL. The ' +
      'owner may overrule this.',
    gap:
      'POLICY_REFUSAL_REASONS has no value for a URL that is not acceptable as written (user-info, ' +
      'no host); `scheme` is used as the closest. The Phase 1 guard unit should propose a reason.',
  },
  {
    id: 'unresolvable-name-is-a-network-error-not-a-refusal',
    what: 'A name that does not resolve is a network error, never a policy refusal',
    input: { url: 'https://not-in-dns.example/p/1', rung: 'http', answer: { kind: 'nxdomain' } },
    expected: { pass: false, outcome: { kind: 'network_error', rung: 'http', code: 'ENOTFOUND' } },
    from:
      'pricewatch/tests/test_fetch_private.py::test_an_unresolvable_name_is_not_a_refusal; ' +
      'test_netguard.py::test_an_unresolvable_name_is_a_502_not_a_403; fetch.py lines 135-137',
    established: ['test', 'ran'],
    note:
      'The predecessor let the request go ahead (its HTTP rung) or answered 502 "unresolvable" ' +
      '(its browser proxy), so that a DNS gap after a wake does not read as a refusal or a wall ' +
      '(S§2.12). The code ENOTFOUND is what Node reports for a name that does not resolve; the ' +
      'spec does not fix the code.',
  },
];
