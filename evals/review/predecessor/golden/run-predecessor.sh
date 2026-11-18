#!/bin/sh
# Re-obtains the golden figures: runs the predecessor's own offline rescoring
# (scripts/web-discovery-eval.py --rescore <run> --review <review>) on its own files, then copies
# its figures verbatim into <out>/<name>.figures.json with evals/review/golden.ts.
#
#   sh evals/review/predecessor/golden/run-predecessor.sh <scratch-dir> <commit> <branch> [<predecessor-dir>]
#
# <predecessor-dir> defaults to ~/Documents/GitHub/hermes-shopping. <commit> and <branch> are
# recorded as given: the predecessor's short HEAD commit and current branch.
#
# No network: the script runs under macOS sandbox-exec with network denied. Nothing is written to
# the predecessor tree: the run JSON is copied to <scratch-dir> first (the script writes its
# rescored result to --json, which points into <scratch-dir>), and the sandbox denies writes under
# <predecessor-dir>. Compare the outputs with the committed golden files as parsed JSON (Biome
# laid the committed ones out differently), e.g. with node's util.isDeepStrictEqual. They are
# equal when the predecessor sits at the same path: the script writes the --review path it was
# given into its output, and so into `scriptOutputSha256`.
set -eu
# Node 26 (.nvmrc) when installed through nvm; otherwise whatever `node` is on PATH.
if [ -x "$HOME/.nvm/versions/node/v26.2.0/bin/node" ]; then PATH="$HOME/.nvm/versions/node/v26.2.0/bin:$PATH"; fi
OUT=$(mkdir -p "$1" && cd "$1" && pwd)
COMMIT=$2
BRANCH=$3
PRED=$(cd "${4:-$HOME/Documents/GitHub/hermes-shopping}" && pwd)
HERE=$(cd "$(dirname "$0")/../../../.." && pwd)
PY="$PRED/pricewatch/.venv/bin/python"
PROFILE="(version 1)(allow default)(deny network*)(deny file-write* (subpath \"$PRED\"))"
PYV=$("$PY" --version 2>&1)
mkdir -p "$OUT/in"
for pair in "2026-10-23-phase5-review:2026-10-23-phase5-evaluation.json" \
            "2026-10-23-matching-review:2026-10-23-matching-eval.json"; do
  name=${pair%%:*}
  run=${pair#*:}
  cp "$PRED/reports/$run" "$OUT/in/$run"
  sandbox-exec -p "$PROFILE" "$PY" -I -B "$PRED/scripts/web-discovery-eval.py" \
    --rescore "$OUT/in/$run" --review "$PRED/scripts/eval/$name.json" \
    --json "$OUT/$name.rescored.json" > "$OUT/$name.stdout" 2> "$OUT/$name.stderr"
  node "$HERE/evals/review/golden.ts" --script-output "$OUT/$name.rescored.json" \
    --predecessor "$PRED" --run "reports/$run" --review "scripts/eval/$name.json" \
    --python "$PYV (pricewatch/.venv/bin/python)" --commit "$COMMIT" --branch "$BRANCH" \
    --command "sandbox-exec (network denied) pricewatch/.venv/bin/python -I -B scripts/web-discovery-eval.py --rescore <copy of reports/$run> --review scripts/eval/$name.json --json <scratch>/$name.rescored.json" \
    > "$OUT/$name.figures.json"
  echo "$name: $OUT/$name.figures.json"
done
