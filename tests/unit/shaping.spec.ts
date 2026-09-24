import { describe, expect, it } from 'vitest'
import {
  SHAPING_DEFAULTS,
  collapseDuplicateRuns,
  collapseRuns,
  elideMiddle,
  resolveShapingConfig,
  shapeText,
  textOf,
} from '@/shaping.ts'

const config = SHAPING_DEFAULTS

describe('collapseDuplicateRuns', () => {
  it('collapses a long identical run', () => {
    const text = ['start', 'same', 'same', 'same', 'same', 'end'].join('\n')
    const result = collapseDuplicateRuns(text, 4)
    expect(result.collapsed).toBe(3)
    expect(result.text).toContain('4 identical lines omitted')
  })

  it('leaves a short run alone', () => {
    const text = ['a', 'same', 'same', 'b'].join('\n')
    expect(collapseDuplicateRuns(text, 4).collapsed).toBe(0)
  })

  it('does not collapse blank-line runs', () => {
    const text = ['a', '', '', '', '', 'b'].join('\n')
    expect(collapseDuplicateRuns(text, 4).collapsed).toBe(0)
  })
})

describe('collapseRuns', () => {
  it('reports changed only when a run collapsed', () => {
    const text = ['x', 'x', 'x', 'x', 'x'].join('\n')
    expect(collapseRuns(text, config).changed).toBe(true)
    expect(collapseRuns('one\ntwo', config).changed).toBe(false)
  })
})

describe('elideMiddle', () => {
  it('keeps head and tail with a reversible locator', () => {
    const text = 'H'.repeat(3000) + 'M'.repeat(20000) + 'T'.repeat(2000)
    const result = elideMiddle(text, config)
    expect(result.changed).toBe(true)
    expect(result.elidedChars).toBeGreaterThan(0)
    expect(result.text).toContain('characters omitted by dsh-terse')
    expect(result.text.startsWith('H')).toBe(true)
    expect(result.text.endsWith('T')).toBe(true)
  })

  it('leaves an under-budget text untouched', () => {
    const result = elideMiddle('small', config)
    expect(result.changed).toBe(false)
    expect(result.text).toBe('small')
  })
})

describe('shapeText', () => {
  it('collapses before eliding so small savings need no locator', () => {
    const text = Array.from({ length: 200 }, () => 'identical log line').join('\n')
    const result = shapeText(text, config)
    expect(result.changed).toBe(true)
    expect(result.collapsedLines).toBeGreaterThan(0)
    expect(result.elidedChars).toBe(0)
  })

  it('leaves ordinary output byte-identical', () => {
    const text = 'npm test\n2 passed\ndone'
    const result = shapeText(text, config)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(text)
  })
})

describe('textOf', () => {
  it('joins text blocks', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })

  it('returns undefined for a non-text block', () => {
    expect(textOf([{ type: 'image', data: 'x' }])).toBeUndefined()
  })

  it('returns undefined for empty content', () => {
    expect(textOf([])).toBeUndefined()
  })
})

describe('resolveShapingConfig', () => {
  it('fills defaults', () => {
    expect(resolveShapingConfig()).toEqual(SHAPING_DEFAULTS)
  })

  it('rejects head plus tail that leaves nothing to elide', () => {
    expect(() => resolveShapingConfig({ maxResultChars: 100, headChars: 80, tailChars: 40 })).toThrow()
  })
})
