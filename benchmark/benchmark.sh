#!/usr/bin/env bash
# Benchmark dsh-terse against a control profile.
#
# Runs one fixed prompt set through two dsh profiles that differ ONLY by the
# dsh-terse bundle layer, then reports output size and wall time per task.
# A neutral DSH_HOME and an EMPTY user AGENTS.md are mandatory: a profile whose
# global instructions already ask for brevity makes the control terse too, and
# the comparison then measures nothing. Nothing here touches a real DSH_HOME.
#
# Usage: benchmark.sh [--home DIR] [--tasks FILE] [--out DIR]
#                    [--terse PROFILE] [--control PROFILE]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOME_DIR="/tmp/dsh-home-bench"
TASKS_FILE="$HERE/../benchmark/tasks.txt"
OUT_DIR="/tmp/dsh-terse-bench"
TERSE_PROFILE="tersedog"
CONTROL_PROFILE="dogplain"

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --tasks) TASKS_FILE="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --terse) TERSE_PROFILE="$2"; shift 2 ;;
    --control) CONTROL_PROFILE="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

export DSH_HOME="$HOME_DIR"
mkdir -p "$OUT_DIR"

if [ ! -f "$TASKS_FILE" ]; then
  echo "task file not found: $TASKS_FILE" >&2
  exit 2
fi

if [ -s "$HOME_DIR/AGENTS.md" ]; then
  echo "warning: $HOME_DIR/AGENTS.md is not empty; the control arm will inherit" >&2
  echo "         its brevity instructions and the comparison will understate savings" >&2
fi

run_one() {
  local profile="$1" label="$2" task="$3" idx="$4"
  local base="$OUT_DIR/$label-$idx" start end code
  start=$(python3 -c 'import time;print(time.time())')
  ( cd /tmp && dsh --profile "$profile" "$task" > "$base.out" 2> "$base.err" )
  code=$?
  end=$(python3 -c 'import time;print(time.time())')
  awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}' > "$base.secs"
  echo "$code" > "$base.code"
  printf '[%s#%s] exit=%s secs=%s bytes=%s\n' "$label" "$idx" "$code" "$(cat "$base.secs")" "$(wc -c < "$base.out" | tr -d ' ')"
}

idx=0
while IFS= read -r task; do
  [ -z "$task" ] && continue
  run_one "$TERSE_PROFILE" terse "$task" "$idx"
  run_one "$CONTROL_PROFILE" control "$task" "$idx"
  idx=$((idx+1))
done < "$TASKS_FILE"

echo "results: $OUT_DIR"
echo "summarize with: $HERE/summarize.py $OUT_DIR"
