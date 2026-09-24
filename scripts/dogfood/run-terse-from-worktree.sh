#!/usr/bin/env bash
#
# Dogfood dsh-terse in a real TUI profile, from a clone of the real home.
#
# Why a clone: a scratch home proves the bundle boots and nothing else, while
# running the real home lets a test session write into the state the daily
# driver reads. Cloning keeps every composition input -- other bundles, the
# profile patch, settings, themes, credentials -- and sends every write to a
# throwaway directory. Unlike the dsh-tui dogfood script, this one ADDS a
# bundle to the existing profile rather than repointing one, because dsh-terse
# composes alongside whatever the profile already runs.
#
#   ./scripts/dogfood/run-terse-from-worktree.sh
#   ./scripts/dogfood/run-terse-from-worktree.sh --profile tui
#   ./scripts/dogfood/run-terse-from-worktree.sh --no-launch
#   ./scripts/dogfood/run-terse-from-worktree.sh --status
#   ./scripts/dogfood/run-terse-from-worktree.sh --clean
set -euo pipefail

name="$(basename "${BASH_SOURCE[0]}")"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
checkout="$(cd "$script_dir/../.." && pwd -P)"
package="@sagmans/dsh-terse"

note() { printf '%s: %s\n' "$name" "$*" >&2; }
die() { printf '%s: error: %s\n' "$name" "$*" >&2; exit 1; }

source_home="$HOME/.dsh"
profile="tui"
scratch="${TMPDIR:-/tmp}/dsh-terse-dogfood"
dsh_bin="${DSH_BIN:-dsh}"
no_launch=0
keep_sessions=0
clean=0
show_status=0
extra_args=()

while [ $# -gt 0 ]; do
  case "$1" in
    --source-home) source_home="$2"; shift 2 ;;
    --profile) profile="$2"; shift 2 ;;
    --scratch) scratch="$2"; shift 2 ;;
    --dsh) dsh_bin="$2"; shift 2 ;;
    --with-sessions) keep_sessions=1; shift ;;
    --no-launch) no_launch=1; shift ;;
    --status) show_status=1; shift ;;
    --clean) clean=1; shift ;;
    --help|-h) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; extra_args=("$@"); break ;;
    *) die "unknown option: $1" ;;
  esac
done

if [ "$clean" = 1 ]; then
  # Only ever remove a directory this script created.
  [ -f "$scratch/.dsh-terse-dogfood" ] || die "refusing to remove $scratch (not created by this script)"
  rm -rf "$scratch"
  note "removed $scratch"
  exit 0
fi

home="$scratch/home"
profile_dir="$home/profiles/$profile"

if [ ! -f "$scratch/.dsh-terse-dogfood" ]; then
  note "cloning $source_home -> $home (sessions excluded)"
  mkdir -p "$scratch"
  if [ "$keep_sessions" = 1 ]; then
    rsync -a --exclude '*.sock' "$source_home/" "$home/"
  else
    rsync -a --exclude 'sessions/' --exclude 'tui-stash/' --exclude '*.sock' "$source_home/" "$home/"
    mkdir -p "$home/sessions"
  fi
  : > "$scratch/.dsh-terse-dogfood"
fi

[ -d "$profile_dir" ] || die "profile \"$profile\" not found in $home"

if [ "$show_status" = 1 ]; then
  echo "scratch:  $scratch"
  echo "home:     $home"
  echo "profile:  $profile"
  echo "bundle:   $package -> $checkout"
  echo "bundles in profile:"
  python3 - "$profile_dir/package.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for b in d.get("dsh", {}).get("profile", {}).get("bundles", []):
    print("  -", b)
PY
  echo "link:"
  ls -l "$profile_dir/node_modules/@sagmans/dsh-terse" 2>/dev/null || echo "  (not linked; run without --status to link)"
  exit 0
fi

# Build so the profile loads current lib/, then link this checkout into the
# profile's own node_modules: a profile resolves its bundles relative to itself.
note "building $checkout"
(cd "$checkout" && pnpm run build >/dev/null)

# A cloned home keeps the profile's own node_modules, but the sibling-bundle links
# inside it are RELATIVE to the original home's depth. The clone sits at a
# different depth, so those links dangle and the profile cannot resolve its own
# bundles. Re-point every local link at a real absolute path before adding the
# bundle under test.
link_dir="$profile_dir/node_modules/@sagmans"
# Relative targets are relative to the ORIGINAL home's link dir, not the clone's,
# so resolve them against that directory and the absolute path comes out right.
source_link_dir="$source_home/profiles/$profile/node_modules/@sagmans"
mkdir -p "$link_dir"
for link in "$link_dir"/*; do
  [ -L "$link" ] || continue
  target="$(readlink "$link")"
  case "$target" in
    /*) resolved="$target" ;;
    *) resolved="$(cd "$source_link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd -P)/$(basename "$target")" ;;
  esac
  if [ -e "$resolved" ]; then
    ln -sfn "$resolved" "$link"
  else
    note "warning: bundle $(basename "$link") -> $target does not resolve; leaving it"
  fi
done

ln -sfn "$checkout" "$link_dir/dsh-terse"

# Register the bundle in the profile manifest if it is not already there.
python3 - "$profile_dir/package.json" "$package" <<'PY'
import json, sys
path, pkg = sys.argv[1], sys.argv[2]
d = json.load(open(path))
bundles = d.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
if pkg not in bundles:
    bundles.append(pkg)
    json.dump(d, open(path, "w"), indent=2)
    open(path, "a").write("\n")
PY

note "linked $package -> $checkout"

run_cmd="DSH_HOME=$home $dsh_bin --profile $profile"
note "run: $run_cmd"

if [ "$no_launch" = 1 ]; then
  printf '\n  %s\n\n' "$run_cmd"
  exit 0
fi

exec env DSH_HOME="$home" "$dsh_bin" --profile "$profile" "${extra_args[@]:-}"