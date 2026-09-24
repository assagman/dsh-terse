#!/usr/bin/env python3
"""Summarize a dsh-terse benchmark run.

Reads the <label>-<idx>.out/.secs files a run directory holds and reports output
size and wall time per arm. Tokens are estimated as non-whitespace characters
divided by four; the constant is crude but identical across arms, so the DELTA
between arms is meaningful even when the absolute number is not.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Reused for every arm so the comparison stays apples-to-apples.
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    return round(len(re.sub(r"\s+", "", text)) / CHARS_PER_TOKEN)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--terse", default="terse")
    ap.add_argument("--control", default="control")
    args = ap.parse_args()

    run = args.run_dir
    tasks = run / "tasks.txt"
    names = [line.strip() for line in tasks.read_text().splitlines() if line.strip()] if tasks.exists() else []

    totals = {args.terse: 0, args.control: 0}
    secs = {args.terse: 0.0, args.control: 0.0}

    print(f"{'task':<7}{args.terse:>8}{args.control:>9}{'delta':>8}{'s_terse':>9}{'s_ctrl':>8}")
    print("-" * 49)
    idx = 0
    while (run / f"{args.terse}-{idx}.out").exists() or (run / f"{args.control}-{idx}.out").exists():
        cells: dict[str, tuple[int, float]] = {}
        for arm in (args.terse, args.control):
            path = run / f"{arm}-{idx}.out"
            text = path.read_text() if path.exists() else ""
            sec_file = run / f"{arm}-{idx}.secs"
            try:
                elapsed = float(sec_file.read_text().strip() or 0)
            except (OSError, ValueError):
                elapsed = 0.0
            cells[arm] = (estimate_tokens(text), elapsed)
            totals[arm] += estimate_tokens(text)
            secs[arm] += elapsed
        t_tok, t_sec = cells[args.terse]
        c_tok, c_sec = cells[args.control]
        delta = f"{100 * (t_tok - c_tok) / c_tok:+.0f}%" if c_tok else "n/a"
        label = names[idx][:6] if idx < len(names) else str(idx)
        print(f"{label:<7}{t_tok:>8}{c_tok:>9}{delta:>8}{t_sec:>9.1f}{c_sec:>8.1f}")
        idx += 1

    print("-" * 49)
    t_tot, c_tot = totals[args.terse], totals[args.control]
    delta = f"{100 * (t_tot - c_tot) / c_tot:+.0f}%" if c_tot else "n/a"
    print(f"{'TOTAL':<7}{t_tot:>8}{c_tot:>9}{delta:>8}{secs[args.terse]:>9.1f}{secs[args.control]:>8.1f}")
    if c_tot:
        print()
        print(f"output tokens: {100 * (c_tot - t_tot) / c_tot:.0f}% fewer")
        if secs[args.control]:
            print(f"wall time:     {100 * (secs[args.control] - secs[args.terse]) / secs[args.control]:.0f}% faster")
    return 0


if __name__ == "__main__":
    sys.exit(main())
