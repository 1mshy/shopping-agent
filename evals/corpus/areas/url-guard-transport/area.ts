import { defineArea } from '../../harness.ts';
import { transportCases } from './cases/transport.ts';
import type { TransportCase } from './contract.ts';

export const area = defineArea<TransportCase>({
  id: 'url-guard-transport',
  status: 'pending',
  sources: [
    'Predecessor: hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit ' +
      '51db126, working tree as it stood on 2026-11-18 (uncommitted files present; the owner has not ' +
      'yet confirmed this is the reference copy)',
    'pricewatch/src/pricewatch/fetch.py: refuse_private (lines 131-153), _refuse_private_landing ' +
      '(171-181), Fetcher.client and _cffi_session (676-703), _get_cffi and get (705-747)',
    'pricewatch/src/pricewatch/netguard.py: module docstring (1-28), resolve (90-105), _open ' +
      '(180-189), _vetted_upstream (192-204)',
    'pricewatch/tests/test_fetch_private.py, pricewatch/tests/test_netguard.py',
  ],
  cases: transportCases,
});
