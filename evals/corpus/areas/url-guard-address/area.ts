import { defineArea } from '../../harness.ts';
import { literalCases } from './cases/literals.ts';
import { nameCases } from './cases/names.ts';
import { urlFormCases } from './cases/url-form.ts';
import type { GuardCase } from './contract.ts';

export const area = defineArea<GuardCase>({
  id: 'url-guard-address',
  status: 'pending',
  sources: [
    'Predecessor: hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit ' +
      '51db126, working tree as it stood on 2026-11-18 (uncommitted files present; the owner confirmed it ' +
      'as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/fetch.py: web_url_problem (lines 111-128), refuse_private (131-153)',
    'pricewatch/src/pricewatch/netguard.py: blocked_address (48-59), _vet_literal (62-68), ' +
      '_vet_infos (71-87), resolve (90-105), is_blocked_host (108-120)',
    'pricewatch/tests/test_fetch_private.py, pricewatch/tests/test_netguard.py (DNS stubbed in both)',
    'Addresses of the owner network and compose subnet in those tests are replaced by fictional ones',
    'docs/progress.md 2026-11-23 "Settled by the orchestrator": every IANA special-purpose range ' +
      'refused; `url_form` for a URL unacceptable as written',
    'IANA IPv4 and IPv6 Special-Purpose Address Registries (iana.org/assignments/iana-ipv4-special-registry, iana-ipv6-special-registry)',
  ],
  cases: [...urlFormCases, ...literalCases, ...nameCases],
});
