// Which status the judged page carries: "Only a challenge (or a blank page) is swapped for the
// store's page in place; a real error page with content of its own whose DOM changes (a clock, a
// carousel) is still an error, not a 200" (fetch.py _settled, lines 1173-1175).
import type { StatusAfterWaitCase } from '../contract.ts';
import * as p from './pages.ts';

const SETTLED = 'fetch.py Fetcher._settled lines 1159-1197';

export const statusAfterWaitCases: readonly StatusAfterWaitCase[] = [
  {
    id: 'blank-page-swapped-for-the-store-page-is-a-200',
    what: "A 403 whose blank document became the store's page in place, with no new document, is a 200",
    input: {
      decide: 'status_after_wait',
      firstStatus: 403,
      first: p.blank,
      newDocumentStatus: null,
      current: p.store,
    },
    expected: 200,
    from: `pricewatch/tests/test_browser_mode.py::test_a_page_swapped_in_place_counts_once_it_is_the_stores; ${SETTLED}`,
    established: ['test', 'ran'],
    specSilent: true,
  },
  {
    id: 'challenge-swapped-for-the-store-page-is-a-200',
    what: "A 403 challenge replaced in place by the store's page, with no new document, is a 200",
    input: {
      decide: 'status_after_wait',
      firstStatus: 403,
      first: p.cloudflare,
      newDocumentStatus: null,
      current: p.store,
    },
    expected: 200,
    from: SETTLED,
    established: ['read', 'ran'],
    specSilent: true,
  },
  {
    id: 'new-document-carries-its-own-status',
    what: "A challenge that cleared by loading the store's page as a new document takes that document's 200",
    input: {
      decide: 'status_after_wait',
      firstStatus: 403,
      first: p.cloudflare,
      newDocumentStatus: 200,
      current: p.store,
    },
    expected: 200,
    from: `pricewatch/tests/test_browser_mode.py::test_a_cloudflare_challenge_that_clears_is_read_not_called_a_wall; ${SETTLED}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'error-page-whose-dom-changes-keeps-its-status',
    what: "A store's 503 page whose countdown changed the DOM is still a 503",
    input: {
      decide: 'status_after_wait',
      firstStatus: 503,
      first: p.maintenance(0),
      newDocumentStatus: null,
      current: p.maintenance(5),
    },
    expected: 503,
    from: `pricewatch/tests/test_browser_mode.py::test_a_real_error_page_whose_dom_changes_is_not_relabelled_a_200; ${SETTLED}`,
    established: ['test', 'ran'],
    specSilent: true,
  },
  {
    id: 'challenge-still-working-keeps-its-status',
    what: 'A 403 challenge whose markup changed but which still shows the challenge stays a 403',
    input: {
      decide: 'status_after_wait',
      firstStatus: 403,
      first: p.cloudflare,
      newDocumentStatus: null,
      current: p.cloudflareLater,
    },
    expected: 403,
    from: `${SETTLED} (a replaced page counts only once it no longer may clear)`,
    established: ['read', 'ran'],
    specSilent: true,
  },
];
