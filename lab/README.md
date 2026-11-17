# lab

The model-free access lab (S§5.16): each transport or route probe is run against a fixed host list and classified. A workspace package (`@agentic-dasher/lab`) so it is linted, typechecked and tested with everything else. It is a dev tool and is excluded from the image (`.dockerignore`).

| Path | What |
|---|---|
| `transport/` | HTTP client comparison against the lab store list (plan P0 spike A) |
| `routes/` | Platform route reachability on sampled domains (plan P0 spike C) |

Rules:

- Tests here run in CI and never touch the network. A live run is a script a person starts.
- A live run is paced (one request in flight per host, S§5.1), capped to the host count in the plan, and identifies nothing about the person running it.
- Raw results are written under a git-ignored `out/` directory; the report with its numbers and sample sizes goes to `docs/spikes/`.
