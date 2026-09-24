import { describe, expect, it } from 'vitest'
import {
  DRIFT_DEFAULTS,
  advance,
  initialCounters,
  judgeReply,
  replyShape,
  resolveDriftConfig,
  shouldNudge,
} from '@/drift.ts'

const config = DRIFT_DEFAULTS

describe('replyShape', () => {
  it('counts fenced code as non-prose', () => {
    const shape = replyShape('Intro sentence here.\n\n```ts\nconst a = 1\nconst b = 2\n```\nDone.')
    expect(shape.fencedBlocks).toBe(1)
    expect(shape.proseChars).toBeLessThan(shape.chars)
  })

  it('treats inline code as non-prose', () => {
    const shape = replyShape('Use `useMemo` here to fix it.')
    expect(shape.proseChars).toBeLessThan(shape.chars)
  })

  it('estimates tokens from non-whitespace characters', () => {
    const shape = replyShape('abcd'.repeat(10))
    expect(shape.tokens).toBe(10)
  })

  it('is zero-safe for empty text', () => {
    expect(replyShape('').tokens).toBe(0)
  })
})

describe('judgeReply', () => {
  it('never judges a short reply', () => {
    expect(judgeReply('Short answer.', config)).toBeUndefined()
  })

  it('flags a long, prose-dominated reply', () => {
    const long = 'word '.repeat(400)
    expect(judgeReply(long, config)).toBe('prose')
  })

  it('does not flag a long reply that is mostly code', () => {
    const code = '```ts\n' + 'const value = compute()\n'.repeat(200) + '```'
    expect(judgeReply(code, config)).toBeUndefined()
  })

  it('flags a long reply that is over budget but not prose-dominated', () => {
    // Half code, half plain text: passes the floor and the budget, fails the ratio.
    const mixed = 'plain words here. '.repeat(120) + '```ts\n' + 'x = 1\n'.repeat(400) + '```'
    const signal = judgeReply(mixed, config)
    expect(signal === 'length' || signal === 'prose').toBe(true)
  })
})

describe('shouldNudge', () => {
  it('stays silent before any trigger', () => {
    const counters = initialCounters()
    advance(counters, 'turn/start')
    advance(counters, 'step/start')
    expect(shouldNudge(counters, 'short reply', config)).toBe(false)
  })

  it('fires on a drifting reply and spends the budget', () => {
    const counters = initialCounters()
    advance(counters, 'turn/start')
    advance(counters, 'step/start')
    const long = 'word '.repeat(400)
    expect(shouldNudge(counters, long, config)).toBe(true)
    expect(counters.nudges).toBe(1)
  })

  it('never nudges twice in one step', () => {
    const counters = initialCounters()
    const long = 'word '.repeat(400)
    advance(counters, 'turn/start')
    advance(counters, 'step/start')
    expect(shouldNudge(counters, long, config)).toBe(true)
    expect(shouldNudge(counters, long, config)).toBe(false)
  })

  it('respects the per-turn cap', () => {
    const counters = initialCounters()
    const long = 'word '.repeat(400)
    advance(counters, 'turn/start')
    let granted = 0
    for (let step = 0; step < 10; step += 1) {
      advance(counters, 'step/start')
      if (shouldNudge(counters, long, config)) granted += 1
    }
    expect(granted).toBe(config.maxNudgesPerTurn)
  })

  it('resets the budget on a new turn', () => {
    const counters = initialCounters()
    const long = 'word '.repeat(400)
    advance(counters, 'turn/start')
    advance(counters, 'step/start')
    shouldNudge(counters, long, config)
    advance(counters, 'turn/start')
    advance(counters, 'step/start')
    expect(shouldNudge(counters, long, config)).toBe(true)
  })

  it('fires the idle backstop after enough steps with no reply', () => {
    const counters = initialCounters()
    advance(counters, 'turn/start')
    let idle = false
    for (let step = 0; step < config.idleStepsBeforeNudge; step += 1) {
      advance(counters, 'step/start')
      idle = idle || shouldNudge(counters, undefined, config)
    }
    expect(idle).toBe(true)
  })
})

describe('resolveDriftConfig', () => {
  it('fills defaults', () => {
    expect(resolveDriftConfig()).toEqual(DRIFT_DEFAULTS)
  })

  it('rejects a non-positive threshold', () => {
    expect(() => resolveDriftConfig({ maxReplyTokens: 0 })).toThrow()
  })

  it('rejects an out-of-range ratio', () => {
    expect(() => resolveDriftConfig({ maxProseRatio: 2 })).toThrow()
  })
})
