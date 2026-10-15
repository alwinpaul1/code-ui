/**
 * A Claude tab matched to its Remote Control session drives Stop, the mode, the model, the effort
 * and permission answers through Anthropic while its link is live, as the Claude app 1.261013.20
 * does, so none of them dies with the relay to the desktop. Every request goes to the tab's OWN
 * session with its own account; with no live link the terminal path stays the route.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import type { CcrUsageAskDeps } from './use-ccr-usage-sheet'
import { useCcrControlLane, type CcrControlLane, type CcrControlLaneArgs } from './use-ccr-control-lane'
import { CCR_PERMISSION_ALLOW, CCR_PERMISSION_DENY } from './ccr-permission-request'
import type { PickDispatch } from './session-option-pick-failure'
import { answerCcrPermissionFromNotification, resetCcrPermissionAnswerersForTests } from './ccr-permission-answerers'
import { mobileChatPermissionKey, parseApprovalFromStatus } from './mobile-native-chat-permission'

const OWN = 'session_01NmzBrN6cdXv6SaRde5pR7H'
const COPY = 'session_019B3GJ144LCrvsuFFkN8U6U'
const target: CcrSendTarget = { kind: 'target', sessionId: OWN, accountId: 'acct-personal' }

let seq = 0
const event = (payload: Record<string, unknown>): CcrEvent => ({ eventId: `e${(seq += 1)}`, sequenceNum: seq, payload: { uuid: `u${seq}`, ...payload } })
const bashRequest = (requestId: string) => event({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: `toolu_${requestId}`, input: { command: 'ls' } } })

/** The session as the lane reaches it: what was posted, by whom, and the reply each request gets. */
function fakeSession(opts: { postFails?: boolean; reply?: (requestId: string) => Record<string, unknown> | null } = {}) {
  const posted: { accountId: string; sessionId: string; payload: Record<string, unknown> }[] = []
  const make: CcrUsageAskDeps = (accountId, sessionId) => {
    let waiting: { id: string; resolve: (payload: Record<string, unknown> | null) => void } | null = null
    let n = 0
    return {
      deps: {
        waitForResponse: (id) => ({ reply: new Promise((resolve) => (waiting = { id, resolve })), cancel: () => waiting?.resolve(null) }),
        post: async (body) => {
          if (opts.postFails) {
            throw new Error('events: network')
          }
          const typed = body as { events: { payload: Record<string, unknown> }[] }
          posted.push({ accountId, sessionId, payload: typed.events[0]!.payload })
          const w = waiting as { id: string; resolve: (payload: Record<string, unknown> | null) => void } | null
          if (w) {
            w.resolve(opts.reply ? opts.reply(w.id) : { type: 'control_response', response: { subtype: 'success', request_id: w.id } })
          }
        },
        newUuid: () => `id-${(n += 1)}`,
        log: () => undefined
      },
      release: () => undefined
    }
  }
  return { posted, make }
}

type Harness = { lane: () => CcrControlLane; update: (patch: Partial<CcrControlLaneArgs>) => void; errors: string[] }

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
  resetCcrPermissionAnswerersForTests()
})

function mount(make: CcrUsageAskDeps, patch: Partial<CcrControlLaneArgs> = {}): Harness {
  const errors: string[] = []
  let current: CcrControlLane | null = null
  let args: CcrControlLaneArgs = {
    enabled: true,
    resolveTarget: () => target,
    linkSessionId: OWN,
    linkPhase: 'live',
    connectionStatus: 'connected',
    events: [],
    onSendError: (message) => errors.push(message),
    makeDeps: make,
    switchOn: true,
    ...patch
  }
  function Probe(props: { args: CcrControlLaneArgs }) {
    current = useCcrControlLane(props.args)
    return null
  }
  act(() => {
    renderer = create(createElement(Probe, { args }))
  })
  return {
    lane: () => current!,
    update: (next) => {
      args = { ...args, ...next }
      act(() => renderer!.update(createElement(Probe, { args })))
    },
    errors
  }
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Stop on a matched tab', () => {
  it('posts an interrupt into the tab’s own session with its own account, relay or no relay', async () => {
    const session = fakeSession()
    const h = mount(session.make)
    const terminal = vi.fn()
    const verdicts: boolean[] = []
    h.lane().wrapStop(terminal)((sent) => verdicts.push(sent))
    await settle()
    expect(session.posted).toEqual([{ accountId: 'acct-personal', sessionId: OWN, payload: { type: 'control_request', uuid: 'id-1', request_id: 'id-2', request: { subtype: 'interrupt' } } }])
    expect(verdicts).toEqual([true])
    expect(terminal).not.toHaveBeenCalled()
    expect(h.errors).toEqual([])
  })

  it('still stops the turn with Escape on the terminal when the interrupt is refused, and says why in one line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const session = fakeSession({ postFails: true })
    const h = mount(session.make)
    const verdicts: boolean[] = []
    const terminal = vi.fn((onVerdict?: (sent: boolean) => void) => onVerdict?.(true))
    h.lane().wrapStop(terminal)((sent) => verdicts.push(sent))
    await settle()
    expect(terminal).toHaveBeenCalledTimes(1)
    expect(verdicts).toEqual([true])
    expect(warn.mock.calls.map((call) => call[0])).toEqual(['[ccr-control] interrupt failed (the request was not posted: events: network) — stopping with Escape on the terminal'])
    // The terminal's own stop says its words if it cannot run; the lane adds none of its own.
    expect(h.errors).toEqual([])
  })

  it('still stops the turn with Escape when the interrupt POST never answers', async () => {
    vi.useFakeTimers()
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const make: CcrUsageAskDeps = () => ({ deps: { waitForResponse: () => ({ reply: new Promise(() => undefined), cancel: () => undefined }), post: () => new Promise(() => undefined), newUuid: () => 'id', log: () => undefined }, release: () => undefined })
      const h = mount(make)
      const terminal = vi.fn()
      h.lane().wrapStop(terminal)()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(terminal).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls.map((call) => call[0])).toEqual(['[ccr-control] interrupt failed (the POST had no answer within 10 s) — stopping with Escape on the terminal'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves Stop to the terminal when the link is not live, the session is offline, or the target is another account’s copy', () => {
    const session = fakeSession()
    const terminal = vi.fn()
    expect(mount(session.make, { linkPhase: 'reconnecting' }).lane().wrapStop(terminal)).toBe(terminal)
    expect(mount(session.make, { connectionStatus: 'disconnected' }).lane().wrapStop(terminal)).toBe(terminal)
    expect(mount(session.make, { resolveTarget: () => ({ kind: 'refused', reason: 'other-account' }) }).lane().wrapStop(terminal)).toBe(terminal)
    expect(mount(session.make, { linkSessionId: COPY }).lane().wrapStop(terminal)).toBe(terminal)
    expect(mount(session.make, { enabled: false }).lane().live).toBe(false)
    expect(session.posted).toEqual([])
  })
})

describe('with the switch off', () => {
  it('drives nothing on a live matched tab: Stop, mode, card, picks and the composer lock all stay as on main', async () => {
    const session = fakeSession()
    const h = mount(session.make, { switchOn: false, events: [event({ type: 'system', subtype: 'init', permissionMode: 'auto' }), bashRequest('req-1')] })
    const terminal = vi.fn()
    const fallback = vi.fn<PickDispatch>(async () => 'accepted')
    expect(h.lane().live).toBe(false)
    expect(h.lane().wrapStop(terminal)).toBe(terminal)
    expect(h.lane().setPermissionMode).toBeUndefined()
    expect(h.lane().permissionMode).toBeNull()
    expect(h.lane().permission).toBeNull()
    await act(async () => {
      await h.lane().wrapDispatch(fallback)('/model opus')
    })
    expect(fallback).toHaveBeenCalledWith('/model opus')
    expect(session.posted).toEqual([])
  })
})

describe('the permission mode on a matched tab', () => {
  it('reads the session’s own mode off the stream', () => {
    const h = mount(fakeSession().make, { events: [event({ type: 'system', subtype: 'init', permissionMode: 'auto' })] })
    expect(h.lane().permissionMode).toBe('auto')
  })

  it('has no mode of its own while the link is not live, so the beacon and screen stay the source', () => {
    const h = mount(fakeSession().make, { linkPhase: 'lost', events: [event({ type: 'system', subtype: 'init', permissionMode: 'auto' })] })
    expect(h.lane().permissionMode).toBeNull()
  })

  it('sends a pick as set_permission_mode and shows it until the session states a newer mode', async () => {
    const session = fakeSession()
    const init = event({ type: 'system', subtype: 'init', permissionMode: 'default' })
    const h = mount(session.make, { events: [init] })
    let message: string | null | undefined
    await act(async () => {
      message = await h.lane().setPermissionMode!('acceptEdits')
    })
    expect(message).toBeNull()
    expect(session.posted[0]!.payload.request).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' })
    expect(h.lane().permissionMode).toBe('acceptEdits')
    h.update({ events: [init, event({ type: 'system', subtype: 'status', permissionMode: 'plan' })] })
    expect(h.lane().permissionMode).toBe('plan')
  })

  it('says "That mode isn’t available right now" and keeps the stated mode when the session refuses', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const session = fakeSession({ reply: (id) => ({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'not allowed' } }) })
    const h = mount(session.make, { events: [event({ type: 'system', subtype: 'init', permissionMode: 'default' })] })
    let message: string | null | undefined
    await act(async () => {
      message = await h.lane().setPermissionMode!('bypassPermissions')
    })
    expect(message).toBe('That mode isn’t available right now')
    expect(h.lane().permissionMode).toBe('default')
  })

  it('keeps the stated mode on the pill when the session never answers the pick', async () => {
    const session = fakeSession({ reply: () => null })
    const h = mount(session.make, { events: [event({ type: 'system', subtype: 'init', permissionMode: 'default' })] })
    let message: string | null | undefined
    await act(async () => {
      message = await h.lane().setPermissionMode!('plan')
    })
    expect(message).toBeNull()
    expect(h.lane().permissionMode).toBe('default')
  })

  it('asks for Manual as Claude Code’s "default"', async () => {
    const session = fakeSession()
    const h = mount(session.make)
    await act(async () => {
      await h.lane().setPermissionMode!('manual')
    })
    expect(session.posted[0]!.payload.request).toEqual({ subtype: 'set_permission_mode', mode: 'default' })
  })
})

describe('model and effort picks on a matched tab', () => {
  it('sends /model as set_model and /effort as apply_flag_settings, never to the terminal', async () => {
    const session = fakeSession()
    const terminal = vi.fn<PickDispatch>(async () => 'accepted')
    const h = mount(session.make)
    const dispatch = h.lane().wrapDispatch(terminal)
    await act(async () => {
      expect(await dispatch('/model claude-opus-5-5')).toBe('accepted')
      expect(await dispatch('/effort high')).toBe('accepted')
    })
    expect(terminal).not.toHaveBeenCalled()
    expect(session.posted.map((post) => post.payload.request)).toEqual([
      { subtype: 'set_model', model: 'claude-opus-5-5' },
      { subtype: 'apply_flag_settings', settings: { effortLevel: 'high', ultracode: false } }
    ])
  })

  it('says the app’s words through the drawer’s own reporter when the session refuses a model', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const session = fakeSession({ reply: (id) => ({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'unknown model' } }) })
    const h = mount(session.make)
    const drawer: string[] = []
    let outcome: string | undefined
    await act(async () => {
      outcome = await h.lane().wrapDispatch(async () => 'accepted')('/model nope', { onError: (message) => drawer.push(message) })
    })
    expect(outcome).toBe('rejected')
    expect(drawer).toEqual(['That model isn’t available for this thread.'])
    expect(h.errors).toEqual([])
  })

  it('says "Couldn’t change effort. Try again." when the effort request could not be posted', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const h = mount(fakeSession({ postFails: true }).make)
    await act(async () => {
      expect(await h.lane().wrapDispatch(async () => 'accepted')('/effort low')).toBe('rejected')
    })
    expect(h.errors).toEqual(['Couldn’t change effort. Try again.'])
  })

  it('types every pick into the terminal as before when the link is not live, and any other command always', async () => {
    const session = fakeSession()
    const terminal = vi.fn<PickDispatch>(async () => 'accepted')
    const down = mount(session.make, { linkPhase: 'reconnecting' })
    await act(async () => {
      await down.lane().wrapDispatch(terminal)('/model opus')
    })
    const up = mount(session.make)
    await act(async () => {
      await up.lane().wrapDispatch(terminal)('/compact')
    })
    expect(terminal.mock.calls.map((call) => call[0])).toEqual(['/model opus', '/compact'])
    expect(session.posted).toEqual([])
  })

  it('keeps one wrapper per dispatch, so a stable dispatch stays stable', () => {
    const h = mount(fakeSession().make)
    const terminal: PickDispatch = async () => 'accepted'
    expect(h.lane().wrapDispatch(terminal)).toBe(h.lane().wrapDispatch(terminal))
  })
})

describe('permission prompts on a matched tab', () => {
  it('draws the prompt from the stream and answers Allow with a control_response into the own session', async () => {
    const session = fakeSession()
    const h = mount(session.make, { events: [bashRequest('r1')] })
    expect(h.lane().permission?.title).toBe('Allow Bash?')
    let sent: boolean | undefined
    await act(async () => {
      sent = await h.lane().respondPermission(`${CCR_PERMISSION_ALLOW}:r1`)!
    })
    expect(sent).toBe(true)
    expect(session.posted).toEqual([
      {
        accountId: 'acct-personal',
        sessionId: OWN,
        payload: { type: 'control_response', uuid: 'id-1', response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', toolUseID: 'toolu_r1', tool_name: 'Bash', updatedInput: { command: 'ls' } } } }
      }
    ])
    expect(h.lane().permission).toBeNull()
  })

  it('says "Failed to deny tool call" and keeps the card when the answer could not be posted', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const h = mount(fakeSession({ postFails: true }).make, { events: [bashRequest('r1')] })
    let sent: boolean | undefined
    await act(async () => {
      sent = await h.lane().respondPermission(`${CCR_PERMISSION_DENY}:r1`)!
    })
    expect(sent).toBe(false)
    expect(h.errors).toEqual(['Failed to deny tool call'])
    expect(h.lane().permission?.title).toBe('Allow Bash?')
  })

  it('draws no card and answers nothing while the link is not live', () => {
    const session = fakeSession()
    const h = mount(session.make, { linkPhase: 'reconnecting', events: [bashRequest('r1')] })
    expect(h.lane().permission).toBeNull()
  })

  it('answers nothing, and says so, when the tapped card is not the prompt the session waits on now', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const session = fakeSession()
    const h = mount(session.make, { events: [bashRequest('r1'), event({ type: 'control_response', response: { subtype: 'success', request_id: 'r1' } }), bashRequest('r2')] })
    let sent: boolean | undefined
    await act(async () => {
      sent = await h.lane().respondPermission(`${CCR_PERMISSION_ALLOW}:r1`)!
    })
    expect(sent).toBe(false)
    expect(session.posted).toEqual([])
    expect(h.errors).toEqual(['Failed to approve tool call'])
  })

  it('hands a terminal key back to the terminal path', () => {
    const h = mount(fakeSession().make, { events: [bashRequest('r1')] })
    expect(h.lane().respondPermission('1')).toBeNull()
  })
})

describe('a notification’s answer on a matched tab', () => {
  // The banner the terminal path builds from Orca's approval envelope for the same prompt.
  const bannerKey = mobileChatPermissionKey(parseApprovalFromStatus(JSON.stringify({ approval: { tool: 'Bash', summary: 'ls' } }))!)
  const scope = { hostId: 'h', worktreeId: 'w', tabId: 'tab-1' }

  it('reaches the prompt this lane holds and posts its control_response', async () => {
    const session = fakeSession()
    mount(session.make, { scope, events: [bashRequest('r1')] })
    let sent: boolean | null | undefined
    await act(async () => {
      sent = await answerCcrPermissionFromNotification({ hostId: 'h', worktreeId: 'w', permissionKey: bannerKey, choice: 'deny', comment: 'not now' })
    })
    expect(sent).toBe(true)
    expect(session.posted.map((post) => post.payload.response)).toEqual([{ subtype: 'success', request_id: 'r1', response: { behavior: 'deny', toolUseID: 'toolu_r1', message: 'not now' } }])
  })

  it('is not reachable while the link is not live', () => {
    mount(fakeSession().make, { scope, linkPhase: 'lost', events: [bashRequest('r1')] })
    expect(answerCcrPermissionFromNotification({ hostId: 'h', worktreeId: 'w', permissionKey: bannerKey, choice: 'allow' })).toBeNull()
  })
})
