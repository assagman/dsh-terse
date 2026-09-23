# benchmark

A reproducible terse-vs-control measurement. Two dsh profiles differ **only** by the
`@sagmans/dsh-terse` bundle layer, and the same fixed prompt set runs through both.

## Why a neutral home is mandatory

The control must not already be terse. If the benchmark `DSH_HOME` carries a user
`AGENTS.md` that asks for brevity, the control arm inherits it and the run measures
nothing. `benchmark.sh` warns when `$DSH_HOME/AGENTS.md` is non-empty for that reason.

Create an isolated home once, with an empty `AGENTS.md`:

```bash
export DSH_HOME=/tmp/dsh-home-neutral
rsync -a --exclude sessions/ --exclude tui-stash/ ~/.dsh/ "$DSH_HOME/"
: > "$DSH_HOME/AGENTS.md"
```

Add the plugin to a copy of a profile that has a working app (for example `headless`),
then run:

```bash
benchmark/benchmark.sh --home "$DSH_HOME" --terse tersedog --control dogplain
benchmark/summarize.py /tmp/dsh-terse-bench
```

Token counts are estimated as non-whitespace characters over four. The constant is crude,
so read the **delta** between arms, not the absolute figure. Output size is a proxy for
cost and speed; it is not a quality score. Review the `.out` files for that.
