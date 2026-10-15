/**
 * The Usage sheet's context figure is asked of the live session, as the Claude app 1.261009.20
 * asks it (rda.java, jhx.java, j7v.java:1158-1219): a `get_context_usage` control request posted
 * to the session's events, answered by a `control_response` on the stream within 45 s.
 */
import { describe, expect, it } from 'vitest'
import {
  askCcrContextUsage,
  buildCcrContextUsageRequestBody,
  CCR_CONTEXT_USAGE_TIMEOUT_MS,
  CcrControlWaiters,
  readCcrContextUsageReply,
  type CcrContextUsageAskDeps
} from './ccr-context-usage'

/** A timer the test advances by hand. */
function manualTimers() {
  const pending: { at: number; run: () => void; live: boolean }[] = []
  let now = 0
  return {
    setTimer: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run, live: true }
      pending.push(timer)
      return () => {
        timer.live = false
      }
    },
    advance: (ms: number) => {
      now += ms
      for (const timer of pending) {
        if (timer.live && timer.at <= now) {
          timer.live = false
          timer.run()
        }
      }
    }
  }
}

const success = (requestId: string, response: Record<string, unknown>) => ({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })

function harness(post: (body: unknown) => Promise<void> = async () => undefined) {
  const timers = manualTimers()
  const waiters = new CcrControlWaiters(timers.setTimer)
  const posted: unknown[] = []
  let n = 0
  const lines: string[] = []
  const deps: CcrContextUsageAskDeps = {
    waitForResponse: (id, ms) => waiters.wait(id, ms),
    post: async (body) => {
      posted.push(body)
      await post(body)
    },
    newUuid: () => `00000000-0000-4000-8000-00000000000${(n += 1)}`,
    log: (line) => lines.push(line)
  }
  return { timers, waiters, posted, deps, lines }
}

describe('asking the session for its context', () => {
  it('posts a get_context_usage control request for the summary, not a message', () => {
    expect(buildCcrContextUsageRequestBody({ sessionId: 'session_01Abc', uuid: 'u-1', requestId: 'r-1' })).toEqual({
      session_id: 'cse_01Abc',
      events: [{ payload: { type: 'control_request', uuid: 'u-1', request_id: 'r-1', request: { subtype: 'get_context_usage', detail: 'summary' } } }]
    })
  })

  it('shows the figure the session answers, 145.5k of 400k as 36%', async () => {
    const h = harness()
    const asked = askCcrContextUsage(h.deps, 'cse_01Abc')
    await Promise.resolve()
    const body = h.posted[0] as { events: { payload: { request_id: string } }[] }
    const requestId = body.events[0]!.payload.request_id
    h.waiters.offer(success(requestId, { totalTokens: 145_500, rawMaxTokens: 400_000 }))
    await expect(asked).resolves.toEqual({ kind: 'answer', answer: { usedTokens: 145_500, windowTokens: 400_000, percent: 36 } })
  })

  it('takes the session’s own percentage when it states one, clamped to 100', () => {
    expect(readCcrContextUsageReply(success('r', { totalTokens: 10, rawMaxTokens: 1000, percentage: 7.6 }))).toEqual({ kind: 'answer', answer: { usedTokens: 10, windowTokens: 1000, percent: 8 } })
    expect(readCcrContextUsageReply(success('r', { totalTokens: 420_000, rawMaxTokens: 400_000 }))).toEqual({ kind: 'answer', answer: { usedTokens: 420_000, windowTokens: 400_000, percent: 100 } })
    expect(readCcrContextUsageReply(success('r', { totalTokens: 0, rawMaxTokens: 400_000 }))).toEqual({ kind: 'answer', answer: { usedTokens: 0, windowTokens: 400_000, percent: 0 } })
  })

  it('never invents a window: a reply with none, or a zero one, is not an answer', () => {
    expect(readCcrContextUsageReply(success('r', { totalTokens: 10 }))).toEqual({ kind: 'refused' })
    expect(readCcrContextUsageReply(success('r', { totalTokens: 10, rawMaxTokens: 0 }))).toEqual({ kind: 'refused' })
    expect(readCcrContextUsageReply({ type: 'control_response', response: { subtype: 'error', request_id: 'r', error: 'not supported' } })).toEqual({ kind: 'refused' })
  })

  it('ignores a reply to another request and says the session did not respond after 45 s', async () => {
    const h = harness()
    const asked = askCcrContextUsage(h.deps, 'cse_01Abc')
    await Promise.resolve()
    h.waiters.offer(success('someone-else', { totalTokens: 1, rawMaxTokens: 2 }))
    h.timers.advance(CCR_CONTEXT_USAGE_TIMEOUT_MS - 1)
    let settled = false
    void asked.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    h.timers.advance(1)
    await expect(asked).resolves.toEqual({ kind: 'unanswered' })
    expect(h.lines.join('\n')).toContain('did not answer within 45 s')
  })

  it('says the session did not respond when the request could not be posted, and stops waiting', async () => {
    const h = harness(() => Promise.reject(new Error('events: 503')))
    await expect(askCcrContextUsage(h.deps, 'cse_01Abc')).resolves.toEqual({ kind: 'unanswered' })
    // The wait was let go at once: a reply arriving later settles nothing.
    h.timers.advance(CCR_CONTEXT_USAGE_TIMEOUT_MS)
    expect(h.lines.join('\n')).toContain('not posted: events: 503')
  })

  it('a session that refuses leaves a line naming why', async () => {
    const h = harness()
    const asked = askCcrContextUsage(h.deps, 'cse_01Abc')
    await Promise.resolve()
    const requestId = (h.posted[0] as { events: { payload: { request_id: string } }[] }).events[0]!.payload.request_id
    h.waiters.offer({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'get_context_usage is not supported in this context' } })
    await expect(asked).resolves.toEqual({ kind: 'refused' })
    expect(h.lines.join('\n')).toContain('refused: get_context_usage is not supported')
  })

  it('a link that closes ends every wait with no reply', async () => {
    const timers = manualTimers()
    const waiters = new CcrControlWaiters(timers.setTimer)
    const a = waiters.wait('a', 1000)
    waiters.closeAll()
    await expect(a.reply).resolves.toBeNull()
  })
})
