/**
 * Input shaping: reducing what the agent READS.
 *
 * Output style is the smaller half of the token bill; in agentic sessions most
 * spend is re-reading logs, diffs, search results, and test output. This module
 * shrinks that stream before it reaches the model.
 *
 * Two rules keep this safe enough to be always-on:
 *
 * - Reversible: an elided result always carries a locator (a spill path or a
 *   count) so the agent can pull the original back with an ordinary tool call.
 *   Nothing is destroyed, only deferred.
 * - Conservative: only *failure-free, block-shaped* content is elided, and only
 *   past a size that makes the locator cheaper than the payload. Error output is
 *   never shaped, because the decisive line is often the last one and a wrong
 *   cut would cost a whole debugging loop.
 *
 * @module dsh-terse/shaping
 */

/** Bounds for tool-output shaping. */
export interface ShapingConfig {
  /** Character count above which a candidate result may be elided. */
  readonly maxResultChars: number
  /** Characters of head kept so the result stays recognizable. */
  readonly headChars: number
  /** Characters of tail kept, because error trails and totals live at the end. */
  readonly tailChars: number
  /** Minimum repeated lines before a run is collapsed. */
  readonly duplicateRunMin: number
}

/**
 * Deployment defaults.
 *
 * The threshold sits well above ordinary tool output so the common case is
 * untouched and pays nothing. Head and tail are generous enough that a shaped
 * result still shows what ran and how it ended.
 */
export const SHAPING_DEFAULTS: ShapingConfig = {
  maxResultChars: 12_000,
  headChars: 3_000,
  tailChars: 1_500,
  duplicateRunMin: 4,
}

/** The shaped text plus what was removed, for the locator line. */
export interface ShapedText {
  readonly text: string
  /** Whether shaping actually changed the text. */
  readonly changed: boolean
  /** Characters removed from the middle, when a middle was removed. */
  readonly elidedChars: number
  /** Duplicate lines collapsed into run markers. */
  readonly collapsedLines: number
}

/** Collapse long runs of identical lines into one line plus a count. */
export function collapseDuplicateRuns(text: string, minRun: number): { text: string; collapsed: number } {
  const lines = text.split('\n')
  const out: string[] = []
  let collapsed = 0
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    let end = index + 1
    while (end < lines.length && lines[end] === line) end += 1
    const run = end - index
    if (run >= minRun && line.trim() !== '') {
      out.push(`${line}`, `  ... [${run} identical lines omitted by dsh-terse]`)
      collapsed += run - 1
    } else {
      for (let i = index; i < end; i += 1) out.push(lines[i] ?? '')
    }
    index = end
  }
  return { text: out.join('\n'), collapsed }
}

/**
 * Apply the cheap, lossless transform first.
 *
 * Duplicate-run collapse is near-lossless (the omitted lines are identical to a
 * kept one) and needs no locator, so it runs unconditionally and often removes
 * enough that the heavier middle-elision never triggers.
 */
export function collapseRuns(text: string, config: ShapingConfig): ShapedText {
  const collapsed = collapseDuplicateRuns(text, config.duplicateRunMin)
  return {
    text: collapsed.text,
    changed: collapsed.collapsed > 0,
    elidedChars: 0,
    collapsedLines: collapsed.collapsed,
  }
}

/**
 * Elide the middle of an oversized block, keeping head and tail with a locator.
 *
 * The middle is chosen over the ends on purpose: a command's identity is at the
 * top and its outcome is at the bottom, while the middle of a long log is where
 * repetition lives. The locator names the omission so the agent can re-run or
 * read the original rather than guess.
 *
 * @param text - the already run-collapsed text.
 * @param config - resolved shaping configuration.
 * @returns the shaped text and accounting.
 */
export function elideMiddle(text: string, config: ShapingConfig): ShapedText {
  if (text.length <= config.maxResultChars) {
    return { text, changed: false, elidedChars: 0, collapsedLines: 0 }
  }
  const head = text.slice(0, config.headChars)
  const tail = text.slice(text.length - config.tailChars)
  const elided = text.length - head.length - tail.length
  const marker = `\n... [${elided} characters omitted by dsh-terse; re-run the command or read the source file for the full output] ...\n`
  return { text: head + marker + tail, changed: true, elidedChars: elided, collapsedLines: 0 }
}

/** Extract the plain text of a tool result's content blocks, when it is text-only. */
export function textOf(blocks: readonly unknown[]): string | undefined {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) return undefined
    const record = block as Record<string, unknown>
    if (record.type !== 'text' || typeof record.text !== 'string') return undefined
    parts.push(record.text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Shape one result's text.
 *
 * Collapse first, then elide only if a middle remains over budget. Returning
 * `changed: false` lets the caller leave the original result object untouched,
 * which keeps an unchanged path allocation-free and byte-identical.
 *
 * @param text - the result text.
 * @param config - resolved shaping configuration.
 * @returns the shaped text and accounting.
 */
export function shapeText(text: string, config: ShapingConfig): ShapedText {
  const collapsed = collapseRuns(text, config)
  const elided = elideMiddle(collapsed.text, config)
  return {
    text: elided.text,
    changed: collapsed.changed || elided.changed,
    elidedChars: elided.elidedChars,
    collapsedLines: collapsed.collapsedLines,
  }
}

/** Validate and apply defaults; fail loud rather than silently shape nothing. */
export function resolveShapingConfig(config: Partial<ShapingConfig> = {}): ShapingConfig {
  const resolved: ShapingConfig = {
    maxResultChars: positive('maxResultChars', config.maxResultChars ?? SHAPING_DEFAULTS.maxResultChars),
    headChars: positive('headChars', config.headChars ?? SHAPING_DEFAULTS.headChars),
    tailChars: positive('tailChars', config.tailChars ?? SHAPING_DEFAULTS.tailChars),
    duplicateRunMin: positive('duplicateRunMin', config.duplicateRunMin ?? SHAPING_DEFAULTS.duplicateRunMin),
  }
  if (resolved.headChars + resolved.tailChars >= resolved.maxResultChars) {
    throw new Error('dsh-terse: headChars + tailChars must be less than maxResultChars, else elision cannot shrink')
  }
  return resolved
}

function positive(field: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`dsh-terse: \`${field}\` must be an integer >= 1 (got ${String(value)})`)
  }
  return value
}
