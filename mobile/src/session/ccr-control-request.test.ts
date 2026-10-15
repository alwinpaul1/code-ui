/**
 * Stop, the model, the effort and the permission mode of a matched Claude tab go to Anthropic as
 * the Claude app 1.261013.20 sends them: a `control_request` on the session's events, the same
 * POST as a message (j7v.java:914-963, lhx.java, gff.java). These pin the bodies byte for byte,
 * the waits, and what each failure says.
 */
import { describe, expect, it } from 'vitest'
import { CcrControlWaiters } from './ccr-context-usage'
import {
  buildCcrControlRequestBody,
  CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS,
  CCR_EFFORT_FAILED,
  CCR_MODE_REFUSED,
  CCR_MODE_UNSENT,
  CCR_MODEL_REFUSED,
  CCR_MODEL_UNSENT,
  CCR_SET_MODEL_TIMEOUT_MS,
  CCR_SET_PERMISSION_MODE_TIMEOUT_MS,
  ccrEffortOutcomeMessage,
  ccrEffortSettings,
  ccrModelOutcomeMessage,
  ccrModeOutcomeMessage,
  postCcrInterrupt,
  CCR_CONTROL_LANE,
  CCR_INTERRUPT_POST_TIMEOUT_MS,
  sendCcrControlRequest,
  type CcrControlDeps
} from './ccr-control-request'

const SESSION = 'session_01NmzBrN6cdXv6SaRde5pR7H'
const CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'

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

function harness(post: (body: unknown) => Promise<void> = async () => undefined) {
  const timers = manualTimers()
  const waiters = new CcrControlWaiters(timers.setTimer)
  const posted: unknown[] = []
  const lines: string[] = []
  let n = 0
  const deps: CcrControlDeps = {
    waitForResponse: (id, ms) => waiters.wait(id, ms),
    post: async (body) => {
      posted.push(body)
      await post(body)
    },
    newUuid: () => `id-${(n += 1)}`,
    log: (line) => lines.push(line)
  }
  return { timers, waiters, posted, lines, deps }
}

const reply = (requestId: string, subtype: string, extra: Record<string, unknown> = {}) => ({ type: 'control_response', response: { subtype, request_id: requestId, ...extra } })

describe('the bodies the Claude app posts', () => {
  it('posts Stop as an interrupt control request into the cse_ session', () => {
    expect(buildCcrControlRequestBody({ sessionId: SESSION, uuid: 'u1', requestId: 'r1', request: { subtype: 'interrupt' } })).toEqual({
      session_id: CSE,
      events: [{ payload: { type: 'control_request', uuid: 'u1', request_id: 'r1', request: { subtype: 'interrupt' } } }]
    })
  })

  it('posts a model pick as set_model with the picked id', () => {
    expect(buildCcrControlRequestBody({ sessionId: SESSION, uuid: 'u1', requestId: 'r1', request: { subtype: 'set_model', model: 'claude-opus-5-5' } }).events[0]!.payload.request).toEqual({ subtype: 'set_model', model: 'claude-opus-5-5' })
  })

  it('posts a mode pick as set_permission_mode', () => {
    expect(buildCcrControlRequestBody({ sessionId: SESSION, uuid: 'u1', requestId: 'r1', request: { subtype: 'set_permission_mode', mode: 'acceptEdits' } }).events[0]!.payload.request).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' })
  })

  it('posts an effort pick as apply_flag_settings with effortLevel and the ultracode flag the pick sets', () => {
    expect(ccrEffortSettings('high')).toEqual({ effortLevel: 'high', ultracode: false })
    expect(ccrEffortSettings('ultracode')).toEqual({ effortLevel: 'ultracode', ultracode: true })
    expect(JSON.stringify(buildCcrControlRequestBody({ sessionId: SESSION, uuid: 'u1', requestId: 'r1', request: { subtype: 'apply_flag_settings', settings: ccrEffortSettings('xhigh') } }))).toBe(
      '{"session_id":"cse_01NmzBrN6cdXv6SaRde5pR7H","events":[{"payload":{"type":"control_request","uuid":"u1","request_id":"r1","request":{"subtype":"apply_flag_settings","settings":{"effortLevel":"xhigh","ultracode":false}}}}]}'
    )
  })

  it('waits 30 s for set_model and set_permission_mode and 45 s for apply_flag_settings, as j7v.d is called', () => {
    expect([CCR_SET_MODEL_TIMEOUT_MS, CCR_SET_PERMISSION_MODE_TIMEOUT_MS, CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS]).toEqual([30_000, 30_000, 45_000])
  })
})

describe('a control request and its answer', () => {
  it('is applied when the session answers its request id with a success', async () => {
    const h = harness()
    const outcome = sendCcrControlRequest(h.deps, SESSION, { subtype: 'set_model', model: 'opus' }, CCR_SET_MODEL_TIMEOUT_MS)
    await Promise.resolve()
    h.waiters.offer(reply('id-2', 'success'))
    expect(await outcome).toBe('applied')
    expect(h.lines).toEqual([])
  })

  it('ignores an answer to another request', async () => {
    const h = harness()
    const outcome = sendCcrControlRequest(h.deps, SESSION, { subtype: 'set_model', model: 'opus' }, CCR_SET_MODEL_TIMEOUT_MS)
    await Promise.resolve()
    h.waiters.offer(reply('someone-else', 'error', { error: 'no' }))
    h.timers.advance(CCR_SET_MODEL_TIMEOUT_MS)
    expect(await outcome).toBe('unanswered')
  })

  it('is refused, and says what the session said in one log line, when the answer is not a success', async () => {
    const h = harness()
    const outcome = sendCcrControlRequest(h.deps, SESSION, { subtype: 'set_permission_mode', mode: 'bypassPermissions' }, CCR_SET_PERMISSION_MODE_TIMEOUT_MS)
    await Promise.resolve()
    h.waiters.offer(reply('id-2', 'error', { error: 'Cannot set permission mode to bypassPermissions' }))
    expect(await outcome).toBe('refused')
    expect(h.lines).toEqual(['[ccr-control] set_permission_mode refused — the session answered: Cannot set permission mode to bypassPermissions'])
  })

  it('is unsent, naming the HTTP failure, when the POST is refused', async () => {
    const h = harness(async () => {
      throw new Error('events: http 409')
    })
    expect(await sendCcrControlRequest(h.deps, SESSION, { subtype: 'apply_flag_settings', settings: ccrEffortSettings('low') }, CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS)).toBe('unsent')
    expect(h.lines).toEqual(['[ccr-control] apply_flag_settings failed — the request was not posted: events: http 409'])
  })

  it('is unanswered after its own wait, not before', async () => {
    const h = harness()
    let settled = false
    const outcome = sendCcrControlRequest(h.deps, SESSION, { subtype: 'apply_flag_settings', settings: ccrEffortSettings('low') }, CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    h.timers.advance(CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS - 1)
    await Promise.resolve()
    expect(settled).toBe(false)
    h.timers.advance(1)
    expect(await outcome).toBe('unanswered')
    expect(h.lines).toEqual(['[ccr-control] apply_flag_settings unanswered — the session did not reply within 45 s'])
  })
})

describe('Stop on Anthropic', () => {
  it('posts the interrupt and waits for no control_response', async () => {
    const h = harness()
    expect(await postCcrInterrupt(h.deps, SESSION, h.timers.setTimer)).toBeNull()
    expect(h.posted).toEqual([{ session_id: CSE, events: [{ payload: { type: 'control_request', uuid: 'id-1', request_id: 'id-2', request: { subtype: 'interrupt' } } }] }])
  })

  it('hands back why the interrupt was not posted, for the one line the fallback leaves', async () => {
    const h = harness(async () => {
      throw new Error('events: HTTP 500')
    })
    expect(await postCcrInterrupt(h.deps, SESSION, h.timers.setTimer)).toBe('the request was not posted: events: HTTP 500')
    expect(h.lines).toEqual([])
  })

  it('gives up on an interrupt POST that never answers, so Stop can fall back instead of hanging', async () => {
    const h = harness(() => new Promise(() => undefined))
    const cause = postCcrInterrupt(h.deps, SESSION, h.timers.setTimer)
    h.timers.advance(CCR_INTERRUPT_POST_TIMEOUT_MS - 1)
    await Promise.resolve()
    h.timers.advance(1)
    expect(await cause).toBe('the POST had no answer within 10 s')
  })
})

describe('the switch', () => {
  it('ships off until the probe proves the bodies, so every control action keeps the terminal path', () => {
    expect(CCR_CONTROL_LANE).toBe(false)
  })
})

describe('what the user is told', () => {
  it('uses the app’s words for a refused or unsent pick and says nothing when it went', () => {
    expect(ccrModelOutcomeMessage('refused')).toBe(CCR_MODEL_REFUSED)
    expect(ccrModelOutcomeMessage('unsent')).toBe(CCR_MODEL_UNSENT)
    expect(ccrModeOutcomeMessage('refused')).toBe(CCR_MODE_REFUSED)
    expect(ccrModeOutcomeMessage('unsent')).toBe(CCR_MODE_UNSENT)
    expect(ccrEffortOutcomeMessage('refused')).toBe(CCR_EFFORT_FAILED)
    expect(ccrEffortOutcomeMessage('unsent')).toBe(CCR_EFFORT_FAILED)
    for (const went of ['applied', 'unanswered'] as const) {
      expect([ccrModelOutcomeMessage(went), ccrModeOutcomeMessage(went), ccrEffortOutcomeMessage(went)]).toEqual([null, null, null])
    }
    expect([CCR_MODEL_REFUSED, CCR_MODEL_UNSENT, CCR_EFFORT_FAILED, CCR_MODE_REFUSED, CCR_MODE_UNSENT]).toEqual([
      'That model isn’t available for this thread.',
      'Model change couldn’t be applied. Try again.',
      'Couldn’t change effort. Try again.',
      'That mode isn’t available right now',
      'Couldn’t change mode. Try again.'
    ])
  })
})
