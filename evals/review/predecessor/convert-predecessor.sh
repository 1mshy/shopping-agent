#!/bin/sh
# Converts every predecessor review file, with the run it reviews, into this directory.
#
#   sh evals/review/predecessor/convert-predecessor.sh (--out | --check) <commit> <branch> [<predecessor-dir>]
#
# --out writes evals/review/predecessor/<name>.json (run `pnpm format` afterwards: Biome lays out
# the JSON); --check converts again and compares with the committed files as parsed JSON.
# <predecessor-dir> defaults to ~/Documents/GitHub/hermes-shopping; it is only read.
set -eu
if [ -x "$HOME/.nvm/versions/node/v26.2.0/bin/node" ]; then PATH="$HOME/.nvm/versions/node/v26.2.0/bin:$PATH"; fi
MODE=$1
COMMIT=$2
BRANCH=$3
PRED=$(cd "${4:-$HOME/Documents/GitHub/hermes-shopping}" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
status=0
for pair in "2026-10-23-phase5-review:2026-10-23-phase5-evaluation.json" \
            "2026-10-23-matching-review:2026-10-23-matching-eval.json"; do
  name=${pair%%:*}
  run=${pair#*:}
  case "$MODE" in
    --out) target="--out" ;;
    --check) target="--check" ;;
    *) echo "first argument: --out or --check" >&2; exit 2 ;;
  esac
  node "$ROOT/evals/review/convert.ts" --predecessor "$PRED" --review "scripts/eval/$name.json" \
    --run "reports/$run" --commit "$COMMIT" --branch "$BRANCH" "$target" "$HERE/$name.json" || status=1
done
exit $status
