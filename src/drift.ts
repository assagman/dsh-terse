/**
 * Drift detection: deciding when a reply has broken the terse contract.
 *
 * This module is deliberately free of Cordis and of the harness types. The
 * decision core is a pure function of observed text and counters, so it can be
 * tested exhaustively and reasoned about without a running agent — the same
 * separation `dsh-tui`'s todo guard uses, and the reason its behaviour is
 * inspectable at all.
 *
 * Design stance: **precision over recall**. A false nudge costs a real step and
 * can annoy the model into over-correcting (which costs tokens and can hurt
 * quality). We therefore nudge only on strong, cheap signals, cap the rate hard,
 * and never nudge a short reply. The nudge exists to catch collapse over a long
 * turn, not to police every sentence.
 *
 * @module dsh-terse/drift
 */

/** Default signal weights and caps for drift detection. */
export interface DriftConfig {
  /** Reply length, in estimated tokens, above which the prose budget is exceeded. */
  readonly maxReplyTokens: number
  /** Minimum estimated reply tokens before any structural signal may fire. */
  readonly minReplyTokensToJudge: number
  /** Prose ratio (0..1) above which a long reply is judged to be padding. */
  readonly maxProseRatio: number
  /**
   * Prose ratio below which a long reply is treated as code, not prose.
   *
   * Code is never the thing terse mode asks to cut, so a long answer that is
   * mostly code is exempt even when it exceeds the token budget. Without this
   * floor a legitimate multi-line implementation would be flagged for drift,
   * which would train the model to shorten exactly the output that must not be
   * shortened.
   */
  readonly minJudgeableProseRatio: number
  /** Whole steps that may pass without a nudge before an idle reminder is allowed. */
  readonly idleStepsBeforeNudge: number
  /** Hard ceiling on nudges per turn; also bounds the extra steps they may cost. */
  readonly maxNudgesPerTurn: number
}

/**
 * Deployment defaults.
 *
 * The reply budget is generous on purpose: measured guidance shows terse output
 * still needs room for real explanation and multi-line code, and a budget tight
 * enough to fire on ordinary answers would cost more in corrections than it
 * saves in output. The idle cadence is the backstop for turns that produce no
 * long reply at all but still drift.
 */
export const DRIFT_DEFAULTS: DriftConfig = {
  maxReplyTokens: 220,
  minReplyTokensToJudge: 60,
  maxProseRatio: 0.72,
  minJudgeableProseRatio: 0.4,
  idleStepsBeforeNudge: 14,
  maxNudgesPerTurn: 2,
}

/** A very small, dependency-free token estimate. */
export interface ReplyShape {
  /** Estimated token count. */
  readonly tokens: number
  /** Non-whitespace characters. */
  readonly chars: number
  /** Count of prose characters (outside fenced code and inline code). */
  readonly proseChars: number
  /** Count of fenced code blocks. */
  readonly fencedBlocks: number
}

/** Whether a reply trips the drift signal, and which one, for logs and tests. */
export type DriftSignal = 'length' | 'prose' | 'idle' | undefined

/**
 * Estimate the shape of one assistant reply.
 *
 * The estimate is intentionally crude: tokenizers differ, a real count would
 * require loading one, and the thresholds are wide enough that a 4-chars-per-
 * token approximation never changes the decision. What matters is separating
 * prose from code, because code is never the thing we ask the model to cut.
 */
export function replyShape(text: string): ReplyShape {
  const chars = text.replace(/\s/g, '').length
  // Fenced blocks, then inline spans, are removed before prose is measured:
  // compression must never touch code, so code must never raise the prose ratio.
  const withoutFences = text.replace(/```[\s\S]*?```/g, (block) => {
    return ''
  })
  const inlineStripped = withoutFences.replace(/`[^`\n]*`/g, '')
  const proseChars = inlineStripped.replace(/\s/g, '').length
  const fencedBlocks = (text.match(/```/g)?.length ?? 0) / 2
  return {
    tokens: Math.ceil(chars / 4),
    chars,
    proseChars,
    fencedBlocks: Math.floor(fencedBlocks),
  }
}

/**
 * Judge one reply.
 *
 * A reply is too long when it exceeds the token budget AND is mostly prose;
 * both must hold, so a long but necessary code answer is never punished. A reply
 * below the judging floor is never judged, which keeps short clarifying answers
 * exempt.
 *
 * @param text - the assistant reply text.
 * @param config - resolved drift configuration.
 * @returns the signal that fired, or undefined to stay silent.
 */
export function judgeReply(text: string, config: DriftConfig): DriftSignal {
  const shape = replyShape(text)
  if (shape.tokens < config.minReplyTokensToJudge) return undefined
  if (shape.tokens <= config.maxReplyTokens) return undefined
  const proseRatio = shape.chars === 0 ? 0 : shape.proseChars / shape.chars
  // Mostly-code replies are exempt regardless of length: the budget governs
  // prose, and flagging code would erode the very output quality terse mode
  // promises to preserve.
  if (proseRatio < config.minJudgeableProseRatio) return undefined
  return proseRatio > config.maxProseRatio ? 'prose' : 'length'
}

/** Per-session counters, bounded by the object's own lifetime. */
export interface DriftCounters {
  /** Model steps observed in the current turn. */
  steps: number
  /** Nudges already emitted in the current turn. */
  nudges: number
  /** Whether this step already carried a nudge, so one step never gets two. */
  nudgedThisStep: boolean
  /** Steps since the last nudge of any kind. */
  stepsSinceNudge: number
}

/** A fresh counter set. */
export function initialCounters(): DriftCounters {
  return { steps: 0, nudges: 0, nudgedThisStep: false, stepsSinceNudge: 0 }
}

/**
 * Advance counters for one durable session event.
 *
 * Turn boundaries reset the per-turn budget; step boundaries reset the per-step
 * flag. Counting steps rather than tool calls means one parallel batch is one
 * step, so a batch can never spend the whole nudge budget at once.
 *
 * @param counters - counters to mutate.
 * @param type - durable session event type.
 */
export function advance(counters: DriftCounters, type: string): void {
  if (type === 'turn/start') {
    counters.steps = 0
    counters.nudges = 0
    counters.nudgedThisStep = false
    counters.stepsSinceNudge = 0
    return
  }
  if (type === 'step/start') {
    counters.steps += 1
    counters.nudgedThisStep = false
    counters.stepsSinceNudge += 1
  }
}

/**
 * Decide whether this step should carry a nudge.
 *
 * Both triggers share one budget and one per-step slot, so a length signal and
 * an idle signal can never double up. Idle only fires once a long stretch of
 * steps has passed with no nudge at all, which is the anti-drift backstop for
 * turns whose replies each stayed just under budget.
 *
 * @param counters - current counters; mutated when a nudge is granted.
 * @param reply - the latest assistant reply text, when one was observed.
 * @param config - resolved drift configuration.
 * @returns whether to emit the nudge this step.
 */
export function shouldNudge(counters: DriftCounters, reply: string | undefined, config: DriftConfig): boolean {
  if (counters.nudgedThisStep || counters.nudges >= config.maxNudgesPerTurn) return false
  const signal = reply === undefined ? undefined : judgeReply(reply, config)
  const idle = counters.stepsSinceNudge >= config.idleStepsBeforeNudge
  if (signal === undefined && !idle) return false
  counters.nudges += 1
  counters.nudgedThisStep = true
  counters.stepsSinceNudge = 0
  return true
}

/** Validate and apply defaults; fail loud rather than silently guard nothing. */
export function resolveDriftConfig(config: Partial<DriftConfig> = {}): DriftConfig {
  return {
    maxReplyTokens: positive('maxReplyTokens', config.maxReplyTokens ?? DRIFT_DEFAULTS.maxReplyTokens),
    minReplyTokensToJudge: positive(
      'minReplyTokensToJudge',
      config.minReplyTokensToJudge ?? DRIFT_DEFAULTS.minReplyTokensToJudge,
    ),
    maxProseRatio: ratio('maxProseRatio', config.maxProseRatio ?? DRIFT_DEFAULTS.maxProseRatio),
    minJudgeableProseRatio: ratio(
      'minJudgeableProseRatio',
      config.minJudgeableProseRatio ?? DRIFT_DEFAULTS.minJudgeableProseRatio,
    ),
    idleStepsBeforeNudge: positive(
      'idleStepsBeforeNudge',
      config.idleStepsBeforeNudge ?? DRIFT_DEFAULTS.idleStepsBeforeNudge,
    ),
    maxNudgesPerTurn: positive('maxNudgesPerTurn', config.maxNudgesPerTurn ?? DRIFT_DEFAULTS.maxNudgesPerTurn),
  }
}

function positive(field: string, value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`dsh-terse: \`${field}\` must be a number >= 1 (got ${String(value)})`)
  }
  return value
}

function ratio(field: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`dsh-terse: \`${field}\` must be in (0, 1] (got ${String(value)})`)
  }
  return value
}
