# Spike A host list

`hosts.json` is the fixed host list of spike A: one product URL per host, and what the predecessor recorded about each host. It is data, built by `build-hosts.ts` from the predecessor's own records, and committed so the run can be repeated without the predecessor:

```sh
node lab/transport/hosts/build-hosts.ts --predecessor ~/Documents/GitHub/hermes-shopping
```

Predecessor copy used: `~/Documents/GitHub/hermes-shopping`, branch `browser-agent`, commit `51db126`, plus uncommitted files (the owner has not confirmed this copy). The builder makes no network request.

## What was read, and nothing else

| Predecessor file | Taken from it |
|---|---|
| `scripts/browser-lab/stores.json` | the 42 lab stores: key, host, group |
| `scripts/browser-lab/results/results.jsonl` | the product pages the browser lab (2026-10-16) opened, and whether its extractor read a price there |
| `data/fetch_playbook.json` | per host, the playbook strategy (`http`, `browser`, `blocked`) and the date it was recorded. No other file in `data/` was opened. |
| `reports/*.json` | URLs on which the predecessor's engine recorded a price, with the method (`http:json-ld`, `browser:selector`, …) and the report's date |

No cookie, token, credential, log, database or personal detail was read or copied. URLs are canonicalised (fragment removed; search-position, ad and analytics parameters such as `dib`, `qid`, `attributionToken`, `queryID`, `trk`, `utm_*` dropped; parameters that pick the product such as `variant`, `sku`, `colourId`, `langId` kept; see `TRACKING` in `hosts.ts`).

## Rules

**Lab stores (42).** The product URL is the page the browser lab opened at its product stage *and on which its extractor read a price*, the most frequent one after canonicalisation (ties: the earliest). A store's own search-results page (`/search`, `/sch/`, `/catalogsearch`, `/search-results` in the path) does not count. When the lab read a price on no product page of the store, the newest priced read on that host in the predecessor's reports stands in (rule below); this happened once (`ebayca`: the lab only reached eBay's search results; `reports/2026-10-23-matching-eval.json` holds an `/itm/` read). Stores with neither are excluded.

**Playbook hosts.** The playbook (`data/fetch_playbook.json`) records 125 hosts, 99 of them not among the lab stores. A playbook host is in the list when the predecessor's reports hold a URL on that host *with a price the engine read* (not a search page): the newest such report, preferring a record that names its rung, first in file order. A host with no such record is left out rather than given an invented URL. 25 of the 99 qualify (the plan asked for "about 30").

| | hosts |
|---|--:|
| Lab stores | 42 |
| … with a product URL | 34 (33 from the lab, 1 from the reports) |
| … excluded (no priced product page on record) | 8; the predecessor's report says why: `digikeyca` (category pages only), `mouserca` (DataDome captcha in every cell), `raspberrypi` (no search), `techcitycanada` (503 maintenance page), `graingerca` (no results), `sandisk` (no readable price), `futuretechs` (password page), `braultmartineau` (13-byte 403 to every client) |
| Playbook hosts outside the lab stores | 99 |
| … with a priced product URL | 25 |
| **Hosts probed** | **59** |

## What the predecessor recorded per host (`predecessor`)

- `playbook`: `{strategy, date}`. The predecessor's fetcher tries a curl_cffi GET first (impersonate profile from `PW_IMPERSONATE`, default `chrome`; the `.env` was not read, so an override cannot be excluded). `http` means that GET returned a usable page (status below 400, no block marker, more than 2,000 characters) the last time the host was recorded; `browser` means it did not and Chromium did; `blocked` means Chromium was walled too. It is per host, not per page kind, and the date is when the entry was last written.
- `read`: the newest priced read on the host in the reports, its rung (`http` = curl_cffi read the price, `browser` = the browser rung did, `unknown` = the record names no rung), method, report and date, and whether it was on the probed URL (`sameUrl`).
- `lab`: for lab stores, how many browser-lab cells ran the store and how many read a price on a product page there.

**The predecessor's browser lab had no HTTP cell.** Its cells were all browsers (`cells.json`: H0-H6, E0-E4, E0P2, HP, EP), and its "31 of 42" is the price count of the best browser cells (H2, H6, E4), not of curl_cffi. The curl_cffi comparison of spike A therefore rests on the playbook and the priced reads above, not on `results/`.
