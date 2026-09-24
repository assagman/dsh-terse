import { describe, expect, it } from 'vitest'
import {
  CONSTITUTION,
  CONSTITUTION_ORDER,
  DRIFT_NUDGE,
  STANDING_ORDER,
  STANDING_REMINDER,
} from '@/instructions.ts'
import { replyShape } from '@/drift.ts'

describe('constitution', () => {
  it('keeps every never-cut class named', () => {
    for (const token of ['not', 'never', 'no', 'only', 'except']) {
      expect(CONSTITUTION).toContain(token)
    }
    for (const concept of [/numbers/i, /units/i, /identifiers/i, /paths/i, /commands/i, /exact error strings/i]) {
      expect(CONSTITUTION).toMatch(concept)
    }
  })

  it('exempts code length in both file and chat', () => {
    expect(CONSTITUTION).toMatch(/in a file or in chat/i)
    expect(CONSTITUTION.replace(/\s+/g, ' ')).toMatch(/never shorten an implementation/i)
  })

  it('keeps the safety valve', () => {
    expect(CONSTITUTION).toMatch(/security warnings/i)
    expect(CONSTITUTION).toMatch(/irreversible/i)
  })

  it('separates form from substance', () => {
    expect(CONSTITUTION).toMatch(/Compress form, never substance/)
  })

  it('keeps persisted non-code artifacts out of scope', () => {
    expect(CONSTITUTION).toMatch(/stay normal prose/i)
  })

  it('stays inside a small token budget', () => {
    // The rules cost input on every request; a runaway constitution would eat
    // the savings it exists to produce. The ceiling is stated in the estimator's
    // own units (non-whitespace chars / 4), which overcounts real prose by
    // roughly 10-20%, so the true cost is near 210 tokens.
    expect(replyShape(CONSTITUTION).tokens).toBeLessThanOrEqual(360)
  })

  it('orders before the first tool section (TOOL_BASH = 1000)', () => {
    expect(CONSTITUTION_ORDER).toBeLessThan(1000)
  })

  it('orders the standing reminder before first-party contexts (SANDBOX_POLICY = 110)', () => {
    expect(STANDING_ORDER).toBeLessThan(110)
  })
})

describe('reminder and nudge', () => {
  it('frames both in system-reminder tags', () => {
    expect(STANDING_REMINDER.startsWith('<system-reminder>')).toBe(true)
    expect(STANDING_REMINDER.endsWith('</system-reminder>')).toBe(true)
    expect(DRIFT_NUDGE.startsWith('<system-reminder>')).toBe(true)
    expect(DRIFT_NUDGE.endsWith('</system-reminder>')).toBe(true)
  })

  it('keeps the nudge within the notice summary bound', () => {
    expect(DRIFT_NUDGE.length).toBeLessThan(300)
  })
})
