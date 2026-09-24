# AGENTS.md

`@sagmans/dsh-terse` is a Cordis plugin for DeepSeek Harness that makes agent output
maximally terse without costing quality. It is always-on and append-only: it contributes a
prompt section, a durable context snapshot, and two `tools/post-execute` behaviours, and it
never touches the deployment's own system prompt. ESM TypeScript (strict), Node >= 22.19,
pnpm. Behaviour, install, and the benchmark that backs the claims:
[README.md](README.md) and [benchmark/README.md](benchmark/README.md).

## Contributing

**`main` is PR-only. Never commit or push to it, not even a one-line fix.** Work in a
worktree on a feature branch, open a pull request, and let it merge there. A fix small enough
to feel exempt is the one most likely to skip review, so there is no size that makes a direct
push acceptable.

Commits are signed and carry DCO:

```sh
git commit -s -S -m "<conventional-commit message>"
```

## Commands

| Task | Command |
| --- | --- |
| Typecheck `src` and `tests` | `pnpm run typecheck` |
| Unit tests | `pnpm test` |
| Build `src` into `lib` | `pnpm run build` |
| Dogfood on the real tui profile | `./scripts/dogfood/run-terse-from-worktree.sh` |

## Map

- `src/index.ts` is the composition root: it wires L1..L6 onto the harness extension
  points and holds the per-session state. Layers are documented by name there.
- `src/instructions.ts` holds every model-facing string. These cost input on every request,
  so they live together and carry a size guard in the specs.
- `src/drift.ts` is the pure decision core for the nudge. It imports neither Cordis nor the
  harness, so it is testable and inspectable in isolation.
- `src/shaping.ts` is the pure input-shaping core (run collapse + middle elision).
- `tests/unit/*.spec.ts` are the focused specs.
- `lib/` is build output and is not edited by hand.

## Sharp edges

**A linked profile loads `lib/`, not `src/`.** Source edits are invisible to
`dsh --profile <name>` until `pnpm run build` runs.

**The constitution is size-guarded on purpose.** It is input cost on every call; a spec fails
if it grows past 360 estimated tokens (a crude estimate that overcounts real prose by roughly
10-20%). Trim wording before raising the ceiling.

**The nudge must never be able to loop.** It is capped per turn and skipped on a
`concludesTurn` result. Removing either guard can make a long turn spin.

**Code is never drift.** `minJudgeableProseRatio` exists so a long implementation is exempt;
without it the nudge would train the model to shorten the output that must not be shortened.

**Tool output elision must stay reversible.** Every elision keeps a locator, and errors are
never shaped. A lossy cut here would cost a whole debugging loop.
