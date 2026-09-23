/**
 * dsh-terse — mandatory, always-on terseness for DeepSeek Harness agents.
 *
 * The plugin compresses everything the agent *emits* and everything it *reads*,
 * without touching the deployment's own system prompt: it contributes sections
 * and context and lets the prompt registry compose, exactly as DeepSeek's own
 * first-party rows do. There is no mode and no off switch; mounting the row is
 * the enabling act.
 *
 * Six layers, each mapped to one harness extension point:
 *
 * - L1 constitution   -> `systemPrompt.section` (static, cache-stable)
 * - L2 standing       -> `systemPrompt.context` (durable snapshot, survives compaction)
 * - L3 nudge + drift  -> `tools/post-execute` `additionalContexts` (rides a result)
 * - L4 input shaping  -> `tools/post-execute` content replacement (reversible)
 * - L5 enforcement    -> `system-prompt/assemble` (observe + log, never rewrite peers)
 * - L6 coverage       -> per-session state keyed by the session object
 *
 * @module dsh-terse
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  CONSTITUTION,
  CONSTITUTION_ORDER,
  DRIFT_NUDGE,
  DRIFT_NUDGE_SUMMARY,
  STANDING_ORDER,
  STANDING_REMINDER,
} from './instructions.ts'
import {
  advance,
  initialCounters,
  resolveDriftConfig,
  shouldNudge,
  type DriftConfig,
  type DriftCounters,
} from './drift.ts'
import {
  resolveShapingConfig,
  shapeText,
  textOf,
  type ShapingConfig,
} from './shaping.ts'

/** The plugin row name, used for provenance on every message it injects. */
export const name = 'dsh-terse'

/** The prompt registry is required; otherwise the constitution has nowhere to land. */
export const inject = ['systemPrompt']

/** Config accepted from the profile patch; every field is a tuning knob. */
export interface Config {
  /** Static constitution text; overriding it replaces the shipped wording. */
  readonly constitution?: string
  /** Standing reminder text; empty suppresses L2 entirely. */
  readonly standing?: string
  /** Whether the L4 input shaper runs. Defaults to true. */
  readonly shaping?: boolean
  /** Drift-detection thresholds. */
  readonly drift?: Partial<DriftConfig>
  /** Input-shaping bounds. */
  readonly shapingConfig?: Partial<ShapingConfig>
}

/** Loader-validated config schema; omitted fields fall back to the shipped defaults. */
export const Config: z<Config> = z.object({
  constitution: z.string(),
  standing: z.string(),
  shaping: z.boolean().default(true),
  drift: z.object({}),
  shapingConfig: z.object({}),
})

/**
 * The frame that states the contract's standing, mirroring first-party context.
 *
 * The precedence sentence is load-bearing: it keeps a style rule from being read
 * as an override of real instructions, which is the one way an always-on prompt
 * contribution could do harm.
 */
const STANDING_INTRO =
  'The following output contract is active for every reply in this session. It does not override system, developer, or direct user instructions.'

/** One session's observation state; keyed by the session object so it dies with the session. */
interface SessionState {
  readonly counters: DriftCounters
  /** Latest committed assistant text, used by the drift judge. */
  lastReply: string | undefined
}

/**
 * Install every layer.
 *
 * Registration order does not affect correctness because each layer attaches to
 * a different extension point, but it is kept L1..L6 to match the documentation.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - optional tuning; the shipped defaults are the product.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const driftConfig = resolveDriftConfig(config.drift ?? {})
  const shapingConfig = resolveShapingConfig(config.shapingConfig ?? {})
  const shaping = config.shaping ?? true

  const states = new WeakMap<object, SessionState>()
  const stateFor = (session: object): SessionState => {
    let state = states.get(session)
    if (state === undefined) {
      state = { counters: initialCounters(), lastReply: undefined }
      states.set(session, state)
    }
    return state
  }

  // L1 — the immutable constitution. Static text keeps the provider prefix
  // reusable, which is what lets an always-on rule set pay for itself.
  ctx.systemPrompt.section({
    name: 'terse:constitution',
    order: CONSTITUTION_ORDER,
    text: () => config.constitution ?? CONSTITUTION,
  })

  // L2 — the durable standing reminder. Delivered through the context channel so
  // it is re-materialized after compaction, where a system-only rule fades.
  const standing = config.standing ?? STANDING_REMINDER
  if (standing !== '') {
    ctx.systemPrompt.context({
      name: 'terse:standing',
      order: STANDING_ORDER,
      text: () => `${STANDING_INTRO}\n\n${standing}`,
    })
  }

  // L6 — follow durable events for turn/step cadence and the latest committed
  // assistant text. Reading the committed message (not the live stream) means a
  // retry or a cancelled stream cannot double-count, and the judge sees exactly
  // what entered history.
  ctx.on('session/event', (session: object, event: { type: string; data?: unknown }) => {
    const state = stateFor(session)
    advance(state.counters, event.type)
    if (event.type === 'assistant/message') {
      const reply = assistantTextOf(event.data)
      if (reply !== undefined) state.lastReply = reply
    }
  })

  // L5 — observe the final assembly. A style contribution has no business
  // rewriting what peer plugins published, so this layer only asserts the
  // constitution survived assembly and otherwise defers; it exists so a future
  // enforcement rule has one obvious home and so a mis-ordered contribution is
  // visible in logs rather than silent.
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const resolved = await next()
    const present = resolved.sections.some((section) => section.name === 'terse:constitution')
    if (!present) {
      ctx.logger.warn('dsh-terse: constitution section missing from assembly; terseness rules are not reaching the model')
    }
    return resolved
  })

  installPostExecute(ctx, stateFor, driftConfig, shaping ? shapingConfig : undefined)
}

/**
 * Extract plain text from one `assistant/message` event payload.
 *
 * The payload is event data rather than a typed message, so it is narrowed
 * defensively: an unexpected shape yields undefined and simply leaves the last
 * observed reply in place, which degrades to the idle trigger instead of
 * throwing inside an event observer (where harness failures are contained, but
 * a silent no-op is still better than a log line per message).
 */
function assistantTextOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const message = (data as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  return textOf(content as readonly unknown[])
}

/**
 * Install the post-execute waterfall that both rides nudges and shapes results.
 *
 * One listener serves both layers because both act on the same result and the
 * waterfall must call `next()` exactly once. Keeping them together is what makes
 * "observe before delegate" and "shape after delegate" correct in a single pass.
 *
 * @param ctx - plugin context.
 * @param stateFor - per-session state accessor.
 * @param driftConfig - resolved drift thresholds.
 * @param shapingConfig - resolved shaping bounds, or undefined when shaping is off.
 */
function installPostExecute(
  ctx: Context,
  stateFor: (session: object) => SessionState,
  driftConfig: DriftConfig,
  shapingConfig: ShapingConfig | undefined,
): void {
  ctx.on(
    'tools/post-execute',
    async (
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ): Promise<PostToolDecision> => {
      const session = exec.agent?.session
      const state = session === undefined ? undefined : stateFor(session)

      // Decide the nudge BEFORE delegating, so a downstream block cannot hide
      // that the step happened; the reminder then rides whatever decision returns.
      // A concluding result ends the turn, so a nudge there would only buy an
      // extra step after the tools have wound down.
      const nudging =
        state !== undefined && result.concludesTurn !== true && shouldNudge(state.counters, state.lastReply, driftConfig)

      const downstream = await next()
      const shaped =
        shapingConfig === undefined ? undefined : shapeResult(downstream, result, shapingConfig)
      const accepted = shaped ?? downstream
      return nudging ? foldNudge(accepted, nudgeMessage()) : accepted
    },
  )
}

/**
 * Replace the accepted content projection with a shaped one, when the result is
 * a text-only success and shaping actually shrinks it.
 *
 * Only an `accept` decision is reshaped: a `block` already replaced the
 * projection with corrective feedback and must keep it. Errors are never shaped
 * even though the candidate content of a failure is often text — the decisive
 * line of a failure is frequently the tail, and the cheap lost saving is not
 * worth a wrong cut.
 *
 * @returns the reshaped decision, or undefined when nothing should change.
 */
function shapeResult(
  downstream: PostToolDecision,
  result: Readonly<ToolExecutionResult>,
  config: ShapingConfig,
): PostToolDecision | undefined {
  if (downstream.kind !== 'accept') return undefined
  if (result.isError === true) return undefined
  const original: readonly ContentBlock[] = downstream.content ?? result.content
  const text = textOf(original as readonly unknown[])
  if (text === undefined) return undefined
  const shaped = shapeText(text, config)
  if (!shaped.changed) return undefined
  // Rebuilt rather than spread because the accept union forbids `content` on the
  // `value` arm; naming the fields keeps this on the content arm by construction.
  const rebuilt: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: shaped.text }] }
  const contexts = downstream.additionalContexts
  return contexts === undefined ? rebuilt : { ...rebuilt, additionalContexts: contexts }
}

/** Build the model-facing nudge message, tagged so history attributes it here. */
function nudgeMessage(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: DRIFT_NUDGE }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary: DRIFT_NUDGE_SUMMARY },
  })
}

/** Prepend this step's nudge while preserving every downstream context's own source. */
function foldNudge(downstream: PostToolDecision, nudge: UserMessage): PostToolDecision {
  const contexts = [nudge, ...(downstream.additionalContexts ?? [])]
  if (downstream.kind === 'block') {
    return { kind: 'block', feedback: downstream.feedback, additionalContexts: contexts }
  }
  return { ...downstream, additionalContexts: contexts }
}
