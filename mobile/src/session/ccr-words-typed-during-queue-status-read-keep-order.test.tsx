/**
 * Words typed on a Claude tab while its turn-end queue reads the session status (use-ccr-composer-
 * send.ts) keep the order they were typed in, whatever the queue's verdict, and an offline session
 * still says so. Second review of the attachment lane, 2026-10-15: they came back ahead of the
 * queue (`second\n\nfirst`), switch on or off, and were accepted without the offline notice.
 */
import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CCR_REMOTE_CONTROL_OFFLINE } from './ccr-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { CCR_SEND_IN_FLIGHT, useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
let statusRead: Promise<string> | null = null
let uuids = 0
const posts: unknown[] = []
let postGate: Promise<void> | null = null
const deps: CcrComposerSendDeps = {
  post: async (_a, _s, body) => {
    posts.push(body)
    if (postGate) { await postGate }
  },
  readStatus: async () => (statusRead ? statusRead : 'connected'),
  log: () => undefined,
  newUuid: () => `uuid-${(uuids += 1)}`
}
const origin = (text: string): MobileNativeChatSendOrigin => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true })
let working = true
let promptUp = false
let composer = ''
const onSendError = vi.fn()
let renderer: ReactTestRenderer | null = null
let api!: ReturnType<typeof useCcrComposerSend>
function Harness(): null {
  const [text, setText] = useState('')
  composer = text
  api = useCcrComposerSend({
    active: true, tabId: 'tab-1',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: 'acct-personal' }),
    events: [], connectionStatus: null, working, promptUp, attachments: () => 0,
    composerText: text, setComposerText: setText,
    captureSendOrigin: origin, clearDraftForSend: vi.fn(), acceptSend: () => 'row-1',
    restoreRejectedDraft: vi.fn(), returnQueueToDraft: vi.fn(), removePending: vi.fn(), onSendError, deps
  })
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  statusRead = null
  postGate = null
  working = true
  promptUp = false
  posts.length = 0
  onSendError.mockClear()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

/** 'first' queued while Claude worked; the turn ends and the queue's status read is held open;
 *  'second' is typed then; the read answers `status`. */
async function typeDuringTheRead(status: string): Promise<string> {
  act(() => { renderer = create(createElement(Harness)) })
  await act(async () => { await api.sendWithOutcome('first') })
  let answer!: (s: string) => void
  statusRead = new Promise((resolve) => { answer = resolve })
  working = false
  act(() => renderer!.update(createElement(Harness)))
  let typed!: Promise<string>
  act(() => { typed = api.sendWithOutcome('second') })
  let outcome = ''
  await act(async () => { answer(status); outcome = await typed })
  await settle()
  return outcome
}

describe('words typed while the turn-end queue reads the session status', () => {
  it('come back after the queue, not before it, when the session is offline, with the offline notice', async () => {
    await typeDuringTheRead('disconnected')
    expect(posts).toEqual([])
    expect(composer).toBe('first\n\nsecond')
    expect(onSendError).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
  })

  it('come back after the queue when a permission prompt is up', async () => {
    promptUp = true
    await typeDuringTheRead('connected')
    expect(posts).toEqual([])
    expect(composer).toBe('first\n\nsecond')
  })

  it('go after the queue when it sends', async () => {
    await typeDuringTheRead('connected')
    expect(posts.map((body) => (body as { events: { payload: { message: { content: string } } }[] }).events[0]!.payload.message.content)).toEqual(['first', 'second'])
    expect(composer).toBe('')
  })

  it('are refused, as before, while another send holds the flight, and the queue comes back ahead of them', async () => {
    act(() => { renderer = create(createElement(Harness)) })
    await act(async () => { await api.sendWithOutcome('first') })
    // A send already out (an outbox resend, say) holds the flight when the turn ends.
    let open!: () => void
    postGate = new Promise((resolve) => { open = resolve })
    working = false
    let other!: Promise<string>
    act(() => { other = api.resendFromOutbox('older', { ccr: { sessionId: CSE, accountId: 'acct-personal', uuid: 'uuid-old' } } as never) })
    await settle()
    act(() => renderer!.update(createElement(Harness)))
    let typed = ''
    await act(async () => { typed = await api.sendWithOutcome('second') })
    expect(typed).toBe('rejected')
    expect(onSendError).toHaveBeenCalledWith(CCR_SEND_IN_FLIGHT)
    await act(async () => { open(); await other })
    await settle()
    expect(composer.startsWith('first')).toBe(true)
  })
})
