# AGENTS.md

`@sagmans/dsh-terse` is a Cordis plugin for DeepSeek Harness that makes agent output
maximally terse without costing quality. It is always-on and append-only: it contributes a
prompt section, a durable context snapshot, and two `tools/post-execute` behaviours, and it
never touches the deployment's own system prompt. ESM TypeScript (strict), Node ^24, pnpm
11.21.0, and the harness window `>=0.1.5-rc.1 <0.1.6` (`dsh.compatibility` in `package.json`):
an API outside that line is not available here. Behaviour, install, and the benchmark that backs
the claims: [README.md](README.md) and [benchmark/README.md](benchmark/README.md). Release
policy: [RELEASE.md](RELEASE.md).

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
| One unit test | `pnpm vitest run tests/unit/drift.spec.ts -t "<name>"` |
| Build `src` into `dist` | `pnpm run build` |
| Built-artifact tests (imports `dist/`) | `pnpm run test:build` |
| Release-guard tests (synthetic CLIs, no writes) | `pnpm test:release` |
| Packed-tarball smoke test | `pnpm run pack-smoke` |
| All of the above | `pnpm run check` |
| Dogfood on the real tui profile | `./scripts/dogfood/run-terse-from-worktree.sh` (`--profile <name>`, `--status`, `--clean`, `--no-launch`) |

`pnpm run check` is the completion bar for a change. Anything touching the prompt strings, the
nudge, or shaping also needs the dogfood run: the unit specs never load the real harness.

## Map

- `src/index.ts` is the composition root: it wires L1..L6 onto the harness extension
  points and holds the per-session state. Layers are documented by name there.
- `src/instructions.ts` holds every model-facing string. These cost input on every request,
  so they live together and carry a size guard in the specs.
- `src/drift.ts` is the pure decision core for the nudge. It imports neither Cordis nor the
  harness, so it is testable and inspectable in isolation.
- `src/shaping.ts` is the pure input-shaping core (run collapse + middle elision).
- `cordis.patch.yml` is the shipped bundle row the manifest's `dsh.bundle.patch` points at: one
  insert that mounts the plugin and carries the shipped thresholds. Mounting that row is the
  only enabling act; there is no off switch.
- `tests/unit/*.spec.ts` are the focused specs.
- `tests/build/*.test.mjs` exercise the built `dist/` artefact, not the sources.
- `tests/release/*.py` exercise `scripts/npm/release.py` through synthetic `npm`/`gh`/`git`
  CLIs, so the guards are covered with zero registry or GitHub writes.
- `scripts/npm/execution.py` is the shared provider boundary: the `CONFIRM=<action>`/`DRY_RUN`
  gate, the pty that answers npm's browser prompt, and the read-retry window live there.
- `scripts/npm/release.py` runs the release actions against `scripts/npm/target.env`, the static
  release identity; every mutation goes through `execution.mutate`, so each write needs its own
  `CONFIRM=<action>`. `scripts/npm/github_release.py` adds the create-only GitHub controls
  behind the same gate, and `tools/pack-smoke.mjs` proves the tarball ships what the manifest
  points at.
- `.github/workflows/check.yml` gates every change; `release.yml` publishes on a `v*` tag
  through npm OIDC trusted publishing behind the `npm-release` approval environment.
- `docs/` holds research and planning notes and is gitignored on purpose; nothing there ships
  or gets committed. `dist/` is build output and is not edited by hand.

## Sharp edges

**`dist/` is both the loaded artefact and the only code that ships.** A linked profile loads
`dist/`, not `src/`, so a source edit stays invisible to `dsh --profile <name>` until
`pnpm run build` runs; and the tarball carries only what `files` names — `dist`,
`cordis.patch.yml`, `README.md` — plus the license and manifest npm always adds, so a runtime
file the build does not emit never reaches an install.

**A published version is immutable and the first one can only be bootstrapped by hand.** npm
needs the package to exist before trusted publishing can be configured, so `release.yml`
skips the publish job for `v0.1.0`; follow [RELEASE.md](RELEASE.md) for that one.

**Dependencies resolve under quarantine.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080`
with the harness lines excluded, and a package whose install runs a build step stays blocked
until it is listed in `allowBuilds`. `.github/dependabot.yml` repeats that window as a 7-day
cooldown and ignores the transitive `@vitest/mocker` major and minor raises the runner cannot
take. CI adds `npm audit signatures` and `pnpm audit --audit-level high` on top of
`pnpm run check`.

**The constitution is size-guarded on purpose.** It is input cost on every call; a spec fails
if it grows past 360 estimated tokens (a crude estimate that overcounts real prose by roughly
10-20%). Trim wording before raising the ceiling.

**The nudge must never be able to loop.** It is capped per turn and skipped on a
`concludesTurn` result. Removing either guard can make a long turn spin.

**Code is never drift.** `minJudgeableProseRatio` exists so a long implementation is exempt;
without it the nudge would train the model to shorten the output that must not be shortened.

**Tool output elision must stay reversible.** Every elision keeps a locator, and errors are
never shaped. A lossy cut here would cost a whole debugging loop.
