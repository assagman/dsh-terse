# dsh-terse

Mandatory, always-on terseness for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
agents. Compresses everything an agent emits and everything it reads, without replacing the
deployment's system prompt and without giving up answer quality.

There is no mode and no off switch. Mounting the row is the enabling act.

## What it does

| Layer | Extension point | Effect |
|---|---|---|
| **L1 constitution** | `systemPrompt.section` | A static, cache-stable rule set that makes every reply compressed. |
| **L2 standing reminder** | `systemPrompt.context` | A durable `<system-reminder>` snapshot that survives compaction, where a system-only rule fades. |
| **L3 drift nudge** | `tools/post-execute` -> `additionalContexts` | A one-line reminder that rides a tool result and catches a reply that ran long. Capped per turn; cannot loop. |
| **L4 input shaping** | `tools/post-execute` content | Collapses repeated lines and elides the middle of oversized tool output, with a locator so the original is one call away. |
| **L5 enforcement** | `system-prompt/assemble` | Asserts the constitution survived assembly; logs a loud warning if it did not. Never rewrites peer contributions. |
| **L6 coverage** | per-session state | Cadence and reply observations keyed by the session object, so a resumed or forked session starts clean. |

## Why it does not hurt quality

Compression is aimed at the **chat mouth**, never at meaning or at durable artifacts:

- **Never cut** negations, quantifiers, numbers, units, code, identifiers, paths, commands, or
  exact error strings. These are the token classes whose loss flips semantics.
- **Never fake terseness.** Invented abbreviations and arrows cost the same tokens and hurt
  clarity; if the terse form is not shorter than plain, plain wins.
- **Full prose returns** for security warnings, irreversible-action confirmations,
  order-sensitive multi-step sequences, and anywhere compression would create ambiguity.
- **Code is never judged as drift**, so a long implementation is never punished.
- **Tool output is only elided reversibly**, never lossy on errors, and the locator lets the
  agent pull the original back.

The evidence behind those choices is in [docs/research.md](docs/research.md).

## Install

The plugin is one row. Add it to a profile:

```bash
dsh plugin --profile <name> add @sagmans/dsh-terse
```

Or insert it directly in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: terse
      name: '@sagmans/dsh-terse'
```

The shipped row is in [cordis.patch.yml](cordis.patch.yml).

## Configuration

Every field is optional; the shipped defaults are the product.

| Field | Default | Meaning |
|---|---|---|
| `constitution` | shipped text | Replaces the L1 rule set. |
| `standing` | shipped text | Replaces the L2 reminder; empty suppresses it. |
| `shaping` | `true` | Whether L4 runs. |
| `drift` | see below | L3 thresholds. |
| `shapingConfig` | see below | L4 bounds. |

```ts
interface DriftConfig {
  maxReplyTokens: number           // 220  reply length above which the prose budget is exceeded
  minReplyTokensToJudge: number    // 60   floor below which no reply is judged
  maxProseRatio: number            // 0.72 prose ratio above which a long reply is padding
  minJudgeableProseRatio: number   // 0.4  below this the reply is code, never judged
  idleStepsBeforeNudge: number     // 14   steps with no nudge before the anti-drift backstop fires
  maxNudgesPerTurn: number         // 2    hard cap on nudges, and so on their extra steps
}

interface ShapingConfig {
  maxResultChars: number   // 12000 threshold above which a result may be elided
  headChars: number        // 3000  head kept
  tailChars: number        // 1500  tail kept, where error trails live
  duplicateRunMin: number  // 4     repeated lines before a run collapses
}
```

## Development

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

A profile loads `lib/`, not `src/`; run `pnpm run build` before dogfooding a linked profile.

## License

MIT.
