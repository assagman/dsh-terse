import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DRIFT_DEFAULTS } from '@/drift.ts'
import { CONSTITUTION, STANDING_REMINDER } from '@/instructions.ts'
import { apply } from '@/index.ts'

/**
 * A minimal fake of the Cordis context surface `apply` touches.
 *
 * The real registry is exercised by dogfooding a live profile; this fake exists
 * to prove the WIRING: which layers register where, that both post-execute
 * concerns share one listener, and that the nudge cannot fire past its cap.
 */
function fakeCtx() {
  const sections: Array<Record<string, unknown>> = []
  const contexts: Array<Record<string, unknown>> = []
  const listeners = new Map<string, Function[]>()
  const ctx = {
    systemPrompt: {
      section: (s: Record<string, unknown>) => { sections.push(s); return () => {} },
      context: (c: Record<string, unknown>) => { contexts.push(c); return () => {} },
    },
    on: (event: string, fn: Function) => {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
      return () => {}
    },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  }
  return { ctx: ctx as unknown as Context, sections, contexts, listeners }
}

const emitter = (listeners: Map<string, Function[]>, event: string) => listeners.get(event) ?? []

describe('apply wiring', () => {
  it('registers the static constitution section', () => {
    const { ctx, sections } = fakeCtx()
    apply(ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('terse:constitution')
    expect((sections[0]?.text as Function)()).toBe(CONSTITUTION)
  })

  it('registers the durable standing context', () => {
    const { ctx, contexts } = fakeCtx()
    apply(ctx)
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.name).toBe('terse:standing')
    expect((contexts[0]?.text as Function)()).toContain('<system-reminder>')
  })

  it('suppresses the standing context when the text is empty', () => {
    const { ctx, contexts } = fakeCtx()
    apply(ctx, { standing: '' })
    expect(contexts).toHaveLength(0)
  })

  it('installs exactly one post-execute listener for both nudge and shaping', () => {
    const { ctx, listeners } = fakeCtx()
    apply(ctx)
    expect(emitter(listeners, 'tools/post-execute')).toHaveLength(1)
  })

  it('does not install a post-execute listener for a nudge that could double-call next', () => {
    const { ctx, listeners } = fakeCtx()
    apply(ctx, { shaping: false })
    // Still one listener: the nudge needs it.
    expect(emitter(listeners, 'tools/post-execute')).toHaveLength(1)
  })
})

describe('post-execute behaviour', () => {
  async function runOne(
    payload: { result: Record<string, unknown>; next?: () => Promise<unknown> },
    config?: Parameters<typeof apply>[1],
  ) {
    const { ctx, listeners } = fakeCtx()
    apply(ctx, config)
    const handler = emitter(listeners, 'tools/post-execute')[0] as Function
    const exec = { agent: { session: {} }, name: 'bash' }
    const next = payload.next ?? (async () => ({ kind: 'accept' }))
    return await handler(exec, payload.result, next)
  }

  it('leaves a small successful result unchanged', async () => {
    const decision = await runOne({ result: { isError: false, content: [{ type: 'text', text: 'ok' }] } })
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('never shapes an error result', async () => {
    const big = Array.from({ length: 3000 }, () => 'boom line').join('\n')
    const decision = await runOne({
      result: { isError: true, content: [{ type: 'text', text: big }] },
    })
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('shapes only when downstream accepted content', async () => {
    const big = Array.from({ length: 5000 }, () => 'same line').join('\n')
    const decision = await runOne({
      result: { isError: false, content: [{ type: 'text', text: big }] },
    }) as { kind: string; content?: Array<{ text: string }> }
    expect(decision.kind).toBe('accept')
    expect(decision.content?.[0]?.text).toContain('omitted by dsh-terse')
  })

  it('leaves a downstream block untouched', async () => {
    const big = Array.from({ length: 5000 }, () => 'same line').join('\n')
    const decision = await runOne({
      result: { isError: false, content: [{ type: 'text', text: big }] },
      next: async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'no' }] }),
    }) as { kind: string; feedback: unknown }
    expect(decision.kind).toBe('block')
    expect(decision.feedback).toEqual([{ type: 'text', text: 'no' }])
  })

  it('skips the nudge on a concluding result', async () => {
    const { ctx, listeners } = fakeCtx()
    apply(ctx, { drift: { idleStepsBeforeNudge: 1 } })
    const handler = emitter(listeners, 'tools/post-execute')[0] as Function
    const session = {}
    const exec = { agent: { session }, name: 'bash' }
    // Drive a step so the idle trigger is armed, then conclude the turn.
    for (const fn of emitter(listeners, 'session/event')) fn(session, { type: 'turn/start' })
    for (const fn of emitter(listeners, 'session/event')) fn(session, { type: 'step/start' })
    const decision = await handler(
      exec,
      { isError: false, concludesTurn: true, content: [{ type: 'text', text: 'done' }] },
      async () => ({ kind: 'accept' }),
    ) as { additionalContexts?: unknown[] }
    expect(decision.additionalContexts).toBeUndefined()
  })

  it('caps nudges per turn even under repeated long replies', async () => {
    const { ctx, listeners } = fakeCtx()
    apply(ctx, { shaping: false, drift: { maxReplyTokens: 10, minReplyTokensToJudge: 5 } })
    const handler = emitter(listeners, 'tools/post-execute')[0] as Function
    const session = {}
    const long = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'word '.repeat(200) }] } } }
    let nudges = 0
    for (const fn of emitter(listeners, 'session/event')) fn(session, { type: 'turn/start' })
    for (let step = 0; step < 8; step += 1) {
      for (const fn of emitter(listeners, 'session/event')) fn(session, { type: 'step/start' })
      for (const fn of emitter(listeners, 'session/event')) fn(session, long)
      const decision = await handler(
        { agent: { session }, name: 'bash' },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
        async () => ({ kind: 'accept' }),
      ) as { additionalContexts?: unknown[] }
      if (decision.additionalContexts !== undefined) nudges += 1
    }
    expect(nudges).toBe(DRIFT_DEFAULTS.maxNudgesPerTurn)
  })
})
