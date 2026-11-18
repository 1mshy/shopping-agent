# lab/transport: HTTP transport comparison (plan P0 spike A)

Reads one product URL per host with each HTTP client behind a small `HttpTransport` seam, and asks whether the page it gets carries a price a structured-data reader could use. The host list and where it came from: [`hosts/README.md`](hosts/README.md). The report: [`docs/spikes/a-http-transport.md`](../../docs/spikes/a-http-transport.md).

## Running

```sh
# pilot: a seeded 6 hosts
node lab/transport/run.ts --pilot 6 --out lab/out/transport/pilot
# full run; resumable (a host with a line in <out>/results.jsonl is skipped)
node lab/transport/run.ts --out lab/out/transport/full --skip lab/out/transport/pilot/results.jsonl
# re-classify offline from the stored bodies (no request)
node lab/transport/reclassify.ts --out lab/out/transport/reclassified lab/out/transport/pilot/results.jsonl lab/out/transport/full/results.jsonl
# tables, and the classification review (every row of a bucket of 30 or fewer, else 15 seeded)
node lab/transport/summarise.ts lab/out/transport/reclassified/*.jsonl
node lab/transport/review.ts lab/out/transport/full/results.jsonl
# fingerprints: loopback capture, and with --echo one request per client to tls.peet.ws
node lab/transport/fingerprint/run.ts --out lab/out/transport/fingerprint --echo
# rebuild the host list from the predecessor's records (no request)
node lab/transport/hosts/build-hosts.ts --predecessor ~/Documents/GitHub/hermes-shopping
```

## Pieces

| File | What |
|---|---|
| `transport.ts` | The seam: one GET, caller's headers only, no redirect following, body cap, timeout, one error vocabulary |
| `clients/` | One adapter per client, each the only importer of its library: `node-fetch.ts` (baseline, spike C's User-Agent), `impit.ts` (`chrome151`), `wreq.ts` (`chrome_149`, its newest). impers is not here (see the report, "Packaging") |
| `get.ts` | The guarded GET: spike C's guard, same-site rule, budget and pacer, imported from `lab/routes`; redirects by hand, each hop re-checked; at most 3 hops; one retry after a network error |
| `probe.ts` | One host: every client one after another, the order rotated by the host's position in the list, per-client cap 5 requests, per-host cap 5 × clients |
| `readable.ts` | The readable criterion (S§5.2 reader ladder short of the browser) |
| `result.ts` | Spike C's classifier with the readable criterion as its validator, plus one body rule from the review |
| `reclassify.ts`, `review.ts`, `summarise.ts` | Offline re-classification from stored bodies, the review listing, the report tables |
| `fingerprint/` | ClientHello parsing, JA4/JA3, the HTTP/2 Akamai string, the loopback capture server, the real-browser reference captures |

Raw results go under `lab/out/transport/` (git-ignored): `results.jsonl` (one line per host: per client the outcome, the classifier's stored input, the request chain, the readable verdict) and `bodies/<sha256>.gz` (every answered body, so the readable criterion can be re-run offline).

## Rules enforced in code

- Only the committed host list (at most 75 hosts), one product URL per host, GET only, no cookie jar in any client (no cookie outlives one request), no login, no form.
- Pacing and the guard are spike C's (`lab/routes/README.md`): one request in flight per host, 2.5-3.25 s between starts to a host, at most 12 in flight; http/https only, private addresses refused, 15 s timeout, 3 MiB body cap.
- Impersonating clients send what their profile sends: the adapters set no User-Agent, client hints or TLS option. The one exception is the fingerprint capture against the lab's own loopback server, where certificate checking is off (a self-signed certificate); its JA4 and HTTP/2 string were checked equal to the same clients' through tls.peet.ws with checking on.
- The baseline sends `agentic-dasher-lab/0.1 (route reachability probe)` and nothing about the person running it.
- The run stops if more than a third of the first 20 hosts are walled or rate limited for every client.
