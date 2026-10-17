// Second review of the bubble-at-the-tap change (2026-10-17, send-bubble-at-tap-terminal.test.ts).
// Each test drives the REAL draft store, message send, image hook and screen look, with the same
// Claude Code 2.1.296 / Codex 0.158.0 screens as the suite under review.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { markMobileNativeChatInputStale, resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { baseArgs, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { hydrateNativeChatOutbox, nativeChatOutboxEntries, nativeChatOutboxWritesSettled, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { outboxEntryLanding, planOutboxEntry } from './native-chat-outbox-recovery-plan'
import { outboxTerminalConfirmedAt } from './native-chat-outbox-drain-plan'
import { outboxEntryDrainable } from './native-chat-outbox-sends'
import { isOutboxSendLive, mountOutboxDrainer, publishOutboxChatRoute, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { OUTBOX_ECHO_PREFIX } from './mobile-native-chat-outbox-drafts'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { parkRefusedComposerSend } from './native-chat-send-gate-outbox'
import { IDLE_AFTER_TURN_0158 } from './fixtures/codex-composer-screens'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments: vi.fn(), pickMobileImageFiles: vi.fn() }))
vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))

const RULE = '─'.repeat(46)
const STATUS = ['                                          [-]', '  Haiku 5.5 medium │ ◔ — ', '  ◷ 5h 4% │ Sat 3:20 AM  ', '  ▦ 7d 45% │ Wed 7:00 PM ']
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const claudeIdle = (input: string): string[] => [...STATUS, RULE, `❯ ${input}`, RULE, FOOTER]
const codexIdle = (input: string): string[] => IDLE_AFTER_TURN_0158.map((row) => (row.startsWith('› ') ? `› ${input}` : row))
const TEXT = 'is everything fixed and done'
const SCOPE = mobileNativeChatScopeKey('h', 'w', 'tab-a')!

type Agent = 'claude' | 'codex'

/** A desktop whose screen reads wait for `answerLooks`; `link` is the socket's state, and
 *  `afterBody` runs on every request once a body has been submitted. */
function desktop(agent: Agent) {
  let input = ''
  let answer: () => void = () => {}
  const looksAnswered = new Promise<void>((resolve) => { answer = resolve })
  const state = {
    submittedBodies: [] as string[],
    sends: [] as string[],
    link: 'connected' as string,
    refuseClear: false,
    afterBody: null as null | ((method: string) => void),
    answerLooks: () => answer(),
    client: null as unknown as RpcClient
  }
  state.client = {
    getState: () => state.link,
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (state.submittedBodies.length > 0 && state.afterBody) { state.afterBody(method) }
      if (method === 'terminal.read') {
        await looksAnswered
        const lines = agent === 'claude' ? claudeIdle(input) : codexIdle(input)
        return ok('r', { terminal: { source: 'screen', tail: lines, lines, draft: '' } })
      }
      if (method !== 'terminal.send') { return ok('x', {}) }
      state.sends.push(params.text ?? '')
      if (state.refuseClear && params.enter !== true && (params.text ?? '').includes('\x15')) {
        return ok('s', { send: { accepted: false } })
      }
      if (params.enter === true || params.text === '\t') {
        state.submittedBodies.push(params.enter === true && params.text ? params.text : input)
        input = ''
        return ok('s', { send: { accepted: true } })
      }
      input = (params.text ?? '').replaceAll(String.fromCharCode(0x15), '')
      return ok('s', { send: { accepted: true } })
    })
  } as unknown as RpcClient
  return state
}

describe.each(['claude', 'codex'] as const)('review: a %s chat message tapped Send on', (agent) => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  const notices: Array<{ message: string; retry?: boolean }> = []
  const unmounts: Array<() => void> = []

  beforeEach(() => {
    notices.length = 0
    resetAppForegroundClockForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    for (const unmount of unmounts.splice(0)) { unmount() }
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  function mount(client: RpcClient, opts: { holdThrows?: boolean } = {}): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-a', sessionId: 'session-1', messages: [], transcriptSettled: true })
      const report = (message: string, details?: { retry?: boolean }): void => {
        notices.push(details?.retry ? { message, retry: true } : { message })
      }
      const send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: null },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        acceptSend: opts.holdThrows ? () => { throw new Error('acceptSend blew up after the write') } : drafts.acceptSend,
        holdUnconfirmedSend: opts.holdThrows ? () => { throw new Error('hold blew up after the write') } : drafts.holdUnconfirmedSend,
        onSendError: report
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent,
          scopeKey: SCOPE,
          hostTerminalOfTab: () => 'term-1',
          refuseUnderDialog: readSendUnderDialogRefusal,
          beginImageSend: drafts.clearDraftAtSendStart,
          beginTextSend: drafts.beginTextSendAtTap,
          parkRefusedSend: (text) =>
            parkRefusedComposerSend({ text, captureSendOrigin: drafts!.captureSendOrigin, clearDraftForSend: drafts!.clearDraftForSend, showSendingEcho: drafts!.showSendingEcho }),
          onSendError: report,
          baseSend: (text, previews, deadline, _attachments, follow) => send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      return null
    }
    act(() => { renderer = create(createElement(ChatScreen)) })
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  async function typeAndTap(text: string): Promise<{ sending: Promise<boolean> }> {
    await act(async () => { drafts!.setComposerText(text) })
    vi.useFakeTimers()
    await advance(300)
    let sending: Promise<boolean> | null = null
    await act(async () => {
      sending = images!.sendNativeChat(text)
      await vi.advanceTimersByTimeAsync(0)
    })
    return { sending: sending! }
  }

  async function settle(sending: Promise<boolean>, steps = 100): Promise<boolean | 'pending' | 'threw'> {
    let result: boolean | 'pending' | 'threw' = 'pending'
    sending.then((value) => { result = value }, () => { result = 'threw' })
    for (let step = 0; step < steps && result === 'pending'; step += 1) { await advance(100) }
    return result
  }

  const bubbles = (): string[] => drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX)).map((item) => item.text)

  function outboxCanSendIt(): void {
    unmounts.push(mountOutboxDrainer())
    unmounts.push(publishOutboxChatRoute(SCOPE, { hostId: 'h', worktreeId: 'w', tabId: 'tab-a', lane: 'terminal', agent, sessionId: 'session-1', terminal: 'term-1', transcriptPath: null }))
  }

  // Finding: the stale-input heal path in the image hook (`if (!healClient) return false`) ends the
  // send with no refuse() and no give-back, after the box emptied at the tap.
  it('does not strand its words in a live outbox entry when the link drops during the look and a stale paste needs healing', async () => {
    markMobileNativeChatInputStale('term-1')
    const tab = desktop(agent)
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    tab.link = 'connecting' // the link drops while the look is out
    tab.answerLooks()
    const result = await settle(sending, 250)
    expect(result).toBe(false)
    expect(tab.submittedBodies).toEqual([])
    const entries = nativeChatOutboxEntries()
    const stranded = entries.some((entry) => isOutboxSendLive(entry.id))
    // Either the words are back in the box with no bubble, or the outbox carries them (not live).
    expect({ composer: drafts!.composerText, bubbles: bubbles(), stranded }).toEqual({ composer: TEXT, bubbles: [], stranded: false })
  })

  // Q2: a throw after the body was written.
  it('does not put words back in the composer that the desktop already submitted, when the send throws after the write', async () => {
    const tab = desktop(agent)
    mount(tab.client, { holdThrows: true })
    const { sending } = await typeAndTap(TEXT)
    tab.answerLooks()
    const result = await settle(sending)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(result).toBe('threw')
    // Sent AND back in the box is a duplicate the moment the user taps Send again.
    expect(drafts!.composerText).toBe('')
  })

  it('does not put submitted words back when every request after the body rejects (a relay that dies mid-verify)', async () => {
    const tab = desktop(agent)
    tab.afterBody = () => { throw new Error('relay session dead') }
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    tab.answerLooks()
    const result = await settle(sending)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect({ result, composer: drafts!.composerText }).toMatchObject({ composer: '' })
  })

  // Q1: a kill while the look is out.
  it('is held from the drainer during the look and sent once by the next process after a kill there', async () => {
    outboxCanSendIt()
    const tab = desktop(agent)
    mount(tab.client)
    await typeAndTap(TEXT)
    const [during] = nativeChatOutboxEntries()
    expect(isOutboxSendLive(during!.id)).toBe(true)
    await act(async () => { await nativeChatOutboxWritesSettled() })
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await hydrateNativeChatOutbox()
    const [entry] = nativeChatOutboxEntries()
    expect(entry).toBeDefined()
    expect(outboxEntryDrainable(entry!)).toBe(true)
    expect(isOutboxSendLive(entry!.id)).toBe(false)
    const landing = outboxEntryLanding(entry!, [], [])
    expect(landing).toBe('missing')
    const plan = planOutboxEntry({ entry: entry!, lane: 'terminal', pendingKey: entry!.pendingKey, transcriptSettled: true, landing, now: outboxTerminalConfirmedAt(entry!) + 1, sendable: true, idleForMs: 5_000, waitedMs: 0, userRetry: false })
    expect(plan).toEqual({ kind: 'send' })
  })

  // Q4: the clear refused (CLEAR_NOT_WRITTEN) after the look: the send's own give-back, then the gate's.
  it('puts the words back once and takes the bubble down when the clear before the body is refused', async () => {
    const tab = desktop(agent)
    tab.refuseClear = true
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    tab.answerLooks()
    expect(await settle(sending)).toBe(false)
    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(notices).toEqual([{ message: 'Message not sent', retry: true }])
  })

  // Q4: the link drops between the image hook's look and the message send's own gate.
  it('hands it to the outbox with its bubble kept when the link drops after the look and the drainer can send it', async () => {
    outboxCanSendIt()
    const tab = desktop(agent)
    mount(tab.client)
    // The look is answered and the link drops before the message send's gate looks.
    const read = tab.client.sendRequest as unknown as (m: string, p: unknown) => Promise<unknown>
    tab.client.sendRequest = vi.fn(async (method: string, params: unknown) => {
      const reply = await read(method, params)
      if (method === 'terminal.read') { tab.link = 'connecting' }
      return reply
    }) as never
    const { sending } = await typeAndTap(TEXT)
    tab.answerLooks()
    const result = await settle(sending, 250)
    expect(tab.submittedBodies).toEqual([])
    expect(result).toBe(true)
    expect(drafts!.composerText).toBe('')
    expect(bubbles()).toEqual([TEXT])
    const [entry] = nativeChatOutboxEntries()
    expect(entry?.unwritten).toBe(true)
    expect(isOutboxSendLive(entry!.id)).toBe(false)
  })

  it('puts the words back when the link drops after the look and nothing could send it later', async () => {
    const tab = desktop(agent)
    mount(tab.client)
    const read = tab.client.sendRequest as unknown as (m: string, p: unknown) => Promise<unknown>
    tab.client.sendRequest = vi.fn(async (method: string, params: unknown) => {
      const reply = await read(method, params)
      if (method === 'terminal.read') { tab.link = 'connecting' }
      return reply
    }) as never
    const { sending } = await typeAndTap(TEXT)
    tab.answerLooks()
    expect(await settle(sending, 250)).toBe(false)
    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  // Link down at the tap: unchanged S4 path, the words wait in the composer.
  it('keeps its words in the composer while it waits for a link that was down at the tap', async () => {
    const tab = desktop(agent)
    tab.link = 'connecting'
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    await advance(500)
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries().every((entry) => entry.atGate === true)).toBe(true)
    tab.link = 'connected'
    tab.answerLooks()
    expect(await settle(sending)).toBe(true)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(drafts!.composerText).toBe('')
  })

  // Typing into the emptied box during the look.
  it('keeps what the user typed during the look when the send goes', async () => {
    const tab = desktop(agent)
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    await act(async () => { drafts!.setComposerText('and the tests') })
    tab.answerLooks()
    expect(await settle(sending)).toBe(true)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(drafts!.composerText).toBe('and the tests')
    expect(bubbles()).toEqual([TEXT])
  })

  it('keeps what the user typed during the look and gets its words back too when the clear is refused', async () => {
    const tab = desktop(agent)
    tab.refuseClear = true
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    await act(async () => { drafts!.setComposerText('and the tests') })
    tab.answerLooks()
    expect(await settle(sending)).toBe(false)
    expect(drafts!.composerText).toContain('and the tests')
    expect(drafts!.composerText).toContain(TEXT)
  })

  // A second Send tapped during the look.
  it('loses neither message when a second Send is tapped while the first one is still looking', async () => {
    const tab = desktop(agent)
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)
    await act(async () => { drafts!.setComposerText('second one') })
    let second: Promise<boolean> | null = null
    await act(async () => {
      second = images!.sendNativeChat('second one')
      await vi.advanceTimersByTimeAsync(0)
    })
    tab.answerLooks()
    const first = await settle(sending)
    const other = await settle(second!)
    expect(first).toBe(true)
    expect(tab.submittedBodies.filter((body) => body === TEXT)).toHaveLength(1)
    // The second went, or its words are back in the box.
    const secondSurvived = tab.submittedBodies.includes('second one') || drafts!.composerText.includes('second one')
    expect({ other, secondSurvived }).toMatchObject({ secondSurvived: true })
    // No bubble for a send that was refused.
    if (!tab.submittedBodies.includes('second one')) { expect(bubbles()).toEqual([TEXT]) }
  })
})
