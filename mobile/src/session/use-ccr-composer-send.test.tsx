/**
 * The composer of a Claude tab that sends through Anthropic (use-ccr-composer-send.ts), against the
 * Claude Android app 1.261009.20 (rs8.F4 the send, rs8.h6 the queue, rs8.T the queue back to the
 * composer, o9a the pending row, qhu the echo by uuid). Echo frames go through the real stream
 * parser in the shape probe P1 saw on 2026-10-15 (`client_event`, `source: "client"`).
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCcrStreamFrame } from './ccr-event-stream'
import { CCR_REMOTE_CONTROL_OFFLINE, type buildCcrUserEventBody } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import { CcrApiError } from './ccr-session-api'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { claudeSendsThroughAnthropic, useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
type Body = ReturnType<typeof buildCcrUserEventBody>

function echo(uuid: string, text: string, sequence = 16): CcrEvent {
  const read = readCcrStreamFrame({
    event: 'client_event',
    id: String(sequence),
    data: JSON.stringify({ event_id: uuid, sequence_num: sequence, event_type: 'user', source: 'client', payload: { type: 'user', uuid, message: { role: 'user', content: text } }, created_at: '2026-10-15T00:41:00Z' })
  })
  if (read.kind !== 'event') {
    throw new Error(read.kind)
  }
  return read.event
}

const state = {
  events: [] as CcrEvent[],
  connectionStatus: 'connected' as string | null,
  working: false,
  promptUp: false,
  composerText: '',
  active: true
}
const posts: { accountId: string; sessionId: string; body: Body }[] = []
const logs: string[] = []
let postImpl: (body: Body) => Promise<void> = async () => undefined
let uuids = 0
const deps: CcrComposerSendDeps = {
  post: async (accountId, sessionId, body) => {
    posts.push({ accountId, sessionId, body })
    await postImpl(body)
  },
  readStatus: vi.fn(async () => 'connected'),
  log: (line) => logs.push(line),
  newUuid: () => `uuid-${(uuids += 1)}`
}
const calls = {
  clear: vi.fn(),
  accept: vi.fn((_origin: MobileNativeChatSendOrigin, _text: string) => 'row-1' as string | null),
  restore: vi.fn(),
  remove: vi.fn(),
  error: vi.fn()
}
let composer = ''
const setComposerText = vi.fn((next: string | ((previous: string) => string)) => {
  composer = typeof next === 'function' ? next(composer) : next
})
const origin = (text: string): MobileNativeChatSendOrigin => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true })

let renderer: ReactTestRenderer | null = null
let api!: ReturnType<typeof useCcrComposerSend>
function Harness(): null {
  api = useCcrComposerSend({
    active: state.active,
    tabId: 'tab-a',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: 'acct-personal' }),
    events: state.events,
    connectionStatus: state.connectionStatus,
    working: state.working,
    promptUp: state.promptUp,
    attachments: () => 0,
    composerText: state.composerText,
    setComposerText,
    captureSendOrigin: origin,
    clearDraftForSend: calls.clear,
    acceptSend: calls.accept,
    restoreRejectedDraft: calls.restore, returnQueueToDraft: vi.fn(),
    removePending: calls.remove,
    onSendError: calls.error,
    deps
  })
  return null
}
function render(): void {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness))
    } else {
      renderer = create(createElement(Harness))
    }
  })
}
async function send(text: string): Promise<string> {
  let outcome = ''
  await act(async () => {
    outcome = await api.sendWithOutcome(text)
  })
  return outcome
}
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  Object.assign(state, { events: [], connectionStatus: 'connected', working: false, promptUp: false, composerText: '', active: true })
  posts.length = 0
  logs.length = 0
  uuids = 0
  composer = ''
  postImpl = async () => undefined
  for (const fn of Object.values(calls)) {
    fn.mockClear()
  }
  calls.accept.mockImplementation(() => 'row-1')
  setComposerText.mockClear()
  render()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('sending from the composer of a Claude tab', () => {
  it('posts the message with a fresh uuid and draws it dimmed until the POST is acked', async () => {
    let release!: () => void
    postImpl = () => new Promise<void>((resolve) => (release = resolve))
    let outcome: Promise<string> | null = null
    act(() => {
      outcome = api.sendWithOutcome('  run the tests  ')
    })
    await settle()
    expect(posts).toEqual([{ accountId: 'acct-personal', sessionId: CSE, body: { session_id: CSE, events: [{ payload: { type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'run the tests' } } }] } }])
    expect(calls.clear).toHaveBeenCalledTimes(1)
    expect(api.deliveries).toEqual({ 'row-1': 'sending' })
    await act(async () => {
      release()
      await outcome
    })
    expect(api.deliveries).toEqual({ 'row-1': 'taken' })
  })

  it('takes the bubble down when the echo carries its uuid, and not on the same words under another uuid', async () => {
    await send('run the tests')
    state.events = [echo('someone-else', 'run the tests')]
    render()
    expect(calls.remove).not.toHaveBeenCalled()
    state.events = [...state.events, echo('uuid-1', 'run the tests', 17)]
    render()
    expect(calls.remove).toHaveBeenCalledWith('row-1')
    expect(api.deliveries).toEqual({})
  })

  it('puts the words back with Retry and a log line naming the session and the cause when the POST fails', async () => {
    postImpl = async () => {
      throw new CcrApiError('events', 'network')
    }
    expect(await send('run the tests')).toBe('rejected')
    expect(calls.remove).toHaveBeenCalledWith('row-1')
    expect(calls.restore).toHaveBeenCalledWith(expect.objectContaining({ normalizedText: 'run the tests' }), 'run the tests')
    expect(calls.error).toHaveBeenCalledWith('Message not sent: network error (no answer from api.anthropic.com)', { retry: true })
    expect(logs).toContain(`[ccr-send] POST events to session …${CSE.slice(-6)} failed: network error (no answer from api.anthropic.com)`)
    expect(api.deliveries).toEqual({})
  })

  // P13, 2026-10-15: POST events into a session whose computer had gone offline answered 409
  // session_not_active. The phone said "Message not sent: HTTP 409" where the app says why.
  it('says the Remote Control session is offline when Anthropic answers that the session is not active', async () => {
    postImpl = async () => {
      throw new CcrApiError('events', 'session-not-active', 409)
    }
    expect(await send('run the tests')).toBe('rejected')
    expect(calls.restore).toHaveBeenCalledWith(expect.objectContaining({ normalizedText: 'run the tests' }), 'run the tests')
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE, { retry: true })
    expect(logs.some((line) => line.includes('session is not active (HTTP 409)'))).toBe(true)
  })

  it('counts a failed POST whose echo was already seen as sent', async () => {
    // The stream carried the echo (the uuid is the one this send will mint) before the POST's
    // answer came back as a failure: the ack was lost, the message was not.
    state.events = [echo('uuid-1', 'run the tests')]
    render()
    postImpl = async () => {
      throw new CcrApiError('events', 'network')
    }
    expect(await send('run the tests')).toBe('accepted')
    expect(calls.restore).not.toHaveBeenCalled()
    expect(calls.error).not.toHaveBeenCalled()
  })

  it('refuses with the app offline message and posts nothing when the Remote Control computer is offline', async () => {
    state.connectionStatus = 'disconnected'
    render()
    expect(await send('run the tests')).toBe('rejected')
    expect(posts).toEqual([])
    expect(calls.clear).not.toHaveBeenCalled()
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
    expect(logs.some((line) => line.includes('offline (connection_status disconnected)'))).toBe(true)
  })

  it('reads the row when the stream has not said whether the computer is online', async () => {
    state.connectionStatus = null
    render()
    vi.mocked(deps.readStatus).mockResolvedValueOnce('disconnected')
    expect(await send('run the tests')).toBe('rejected')
    expect(posts).toEqual([])
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
  })

  it('sends nothing for empty or blank text', async () => {
    expect(await send('')).toBe('rejected')
    expect(await send('  \n ')).toBe('rejected')
    expect(posts).toEqual([])
    expect(calls.clear).not.toHaveBeenCalled()
  })

  it('refuses a second send while the first is in flight', async () => {
    postImpl = () => new Promise<void>(() => undefined)
    act(() => {
      void api.sendWithOutcome('first')
    })
    await settle()
    expect(await send('second')).toBe('rejected')
    expect(posts).toHaveLength(1)
    expect(calls.error).toHaveBeenCalledWith('Another input is still being sent. Try again.')
  })
})

describe('the queue while Claude works', () => {
  beforeEach(() => {
    state.working = true
    render()
  })

  it('keeps one queued message, posts nothing, and empties the composer', async () => {
    expect(await send('add a test')).toBe('accepted')
    expect(api.queue).toEqual(['add a test'])
    expect(posts).toEqual([])
    expect(calls.clear).toHaveBeenCalledTimes(1)
  })

  // Until 2026-10-16 a further send was joined to the queued one after a blank line (the app's
  // one-string queue); the user reported it as two messages turned into one.
  it('keeps a further message as its own queue entry', async () => {
    await send('add a test')
    await send('then run it')
    expect(api.queue).toEqual(['add a test', 'then run it'])
  })

  it('sends only the first queued message, as an ordinary message, when the turn ends', async () => {
    await send('add a test')
    await send('then run it')
    state.working = false
    render()
    await settle()
    expect(posts.map((post) => post.body.events[0]!.payload)).toEqual([{ type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'add a test' } }])
    expect(api.queue).toEqual(['then run it'])
  })

  it('moves the queue back to the composer, before the draft, when a draft blocks it at the turn end', async () => {
    await send('add a test')
    composer = 'half typed'
    state.composerText = 'half typed'
    state.working = false
    render()
    await settle()
    expect(posts).toEqual([])
    expect(composer).toBe('add a test\n\nhalf typed')
    expect(api.queue).toEqual([])
    expect(logs).toContain('[ccr-send] queued message moved back to the composer: the composer has a draft')
  })

  it('moves the queue back to the composer when a prompt is waiting at the turn end', async () => {
    await send('add a test')
    state.promptUp = true
    state.working = false
    render()
    await settle()
    expect(posts).toEqual([])
    expect(composer).toBe('add a test')
  })

  it('does nothing at the turn end with an empty queue', async () => {
    state.working = false
    render()
    await settle()
    expect(posts).toEqual([])
    expect(setComposerText).not.toHaveBeenCalled()
  })

  it('a tap on the queued message moves it back to the composer and empties the queue', async () => {
    await send('add a test')
    act(() => api.editQueue(0))
    expect(composer).toBe('add a test')
    expect(api.queue).toEqual([])
    act(() => api.editQueue(0))
    expect(composer).toBe('add a test')
  })

  it('posts a queue left behind as a post-later message when the chat closes', async () => {
    await send('add a test')
    act(() => renderer?.unmount())
    renderer = null
    await settle()
    expect(posts.map((post) => post.body.events[0]!.payload)).toEqual([{ type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'add a test' }, priority: 'later' }])
  })
})

describe('which tabs send through Anthropic', () => {
  it('a Claude tab matched, or being matched, to its Remote Control session', () => {
    expect(claudeSendsThroughAnthropic(true, { kind: 'matched', accountId: 'a', sessionId: CSE })).toBe(true)
    expect(claudeSendsThroughAnthropic(true, { kind: 'finding' })).toBe(true)
  })

  it('not a tab the gate is off for (Codex and the other agents), nor a Claude tab with nothing on Anthropic to send to', () => {
    expect(claudeSendsThroughAnthropic(false, { kind: 'matched', accountId: 'a', sessionId: CSE })).toBe(false)
    for (const gate of [{ kind: 'off' }, { kind: 'signed-out' }, { kind: 'new' }, { kind: 'orca-empty', status: 'waiting-session' }, { kind: 'unmatched', detail: 'x' }] as const) {
      expect(claudeSendsThroughAnthropic(true, gate)).toBe(false)
    }
  })
})
