// A message sent while Claude works is drawn as delivered only on Claude's own record of it.
//
// Reported 2026-10-11 on 0.9.128 (Claude Code 2.1.296, a hand-started `claude -r codeui` tab,
// three background tasks running, the phone's composer reading "Queue a message…"): "Is all of
// asks done", sent at 11:51, was drawn as a sent bubble and never reached Claude. Orca's
// terminal-history log of that tab shows Claude's input box empty from the turn's start
// (09:50:54Z) to 09:54:50Z, when the next message was typed, so the words were never in it; the
// transcript has no row, no queue-operation and no attachment of them. Three minutes later a
// screen recording and then "Is all of the asks done" went through mid-turn, each a
// queue-operation enqueue, absorbed_mid_turn.
//
// What the phone did: after the host acked the body, its check (verifyClaudeSubmit) called the
// send delivered on its own reading of the screen: no look at all (`unverified`, two reads that
// failed), or the words seen in the input and then gone. Neither is Claude's record. The send
// was accepted, its outbox entry retired, and nothing could ever send it again. Claude's record,
// as the phone reads it, is the prompt copy (the hook beacon's `up=`, or the prompt Orca's own
// UserPromptSubmit hook puts on the tab status, which fires at the enqueue mid-turn) or the
// transcript row. Without one the send is now held like an ack that never came: the hold waits
// for the copy or the row, and the outbox sends it again once the agent is idle.
//
// Screens: the working lead of fixtures/claude-busy-lead-tasks-2.1.296 (`tmux capture-pane` of
// Claude Code 2.1.296 with a shell and an agent running, blank rows dropped as Orca's screen read
// does), with the words drawn in its input box where a step needs them there.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { busyScreen } from './fixtures/claude-busy-lead-tasks-2.1.296'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { chatSendOutcomeOfVerdict, writeChatSend } from './mobile-native-chat-send-write'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { parkUnconfirmedSend } from './mobile-native-chat-unconfirmed-hold'
import { promptIsReceiptOf } from './native-chat-outbox-headless'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'

vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

const WORDS = 'Is all of asks done'
/** The prompt copies the incident's tab had already given (Orca's hook on the tab status). */
const HOOKED_COPIES: readonly BeaconPromptReceipt[] = [{ nonce: 'status:s:1:0', text: 'Fix the flicker' }]
const BUSY = busyScreen('screen-busy-lead-mid.txt', { dropBlank: true })
const COMPOSER_ROW = BUSY.findIndex((row, index) => row.startsWith('❯') && /─{3}/.test(BUSY[index - 1] ?? ''))

/** The working lead's screen with `input` in its box, and `queued` rows drawn above the rule the
 *  way Claude draws a prompt it has taken (`❯ ` and a plain space). */
function busyWith(input: string, queued: readonly string[] = []): string[] {
  const rows = [...BUSY]
  rows[COMPOSER_ROW] = `❯ ${input}`
  rows.splice(COMPOSER_ROW - 1, 0, ...queued.map((row) => `❯ ${row}`))
  return rows
}

const screenReply = (lines: string[]): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { source: 'screen', tail: lines, draft: '' } },
  _meta: { runtimeId: 'rt' }
})
const accepted: RpcResponse = { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'rt' } }

/** Orca in front of the working tab: every write acked; each screen read answered by `look`
 *  (its index among the reads made after the body went out, -1 before), or a failed read. */
function workingTab(look: (afterBody: number) => string[] | 'fail') {
  const writes: string[] = []
  let bodyWritten = false
  let readsAfterBody = 0
  const sendRequest = vi.fn(async (method: string, params: unknown) => {
    const body = (params ?? {}) as { text?: string; enter?: boolean }
    if (method === 'terminal.send') {
      writes.push(body.text ?? '')
      if (body.enter === true) {
        bodyWritten = true
      }
      return accepted
    }
    if (method === 'terminal.read') {
      const answer = look(bodyWritten ? readsAfterBody++ : -1)
      if (answer === 'fail') {
        throw new Error('timed out')
      }
      return screenReply(answer)
    }
    throw new Error(`unexpected ${method}`)
  })
  const client = { sendRequest, getState: () => 'connected', notifyForeground: vi.fn(), getLastConnectedAt: () => 1 }
  return { client: client as unknown as RpcClient, writes }
}

describe('a message sent while Claude works, that Claude never took', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const acceptSend = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const report = vi.fn()

  const mount = (client: RpcClient, promptReceipts: readonly BeaconPromptReceipt[] = []): void => {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'codeui' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: 'claude' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: vi.fn(),
        restoreRejectedDraft,
        acceptSend,
        holdUnconfirmedSend,
        onSendError: report,
        promptReceipts
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  const send = async (): Promise<MobileNativeChatSendOutcome> => {
    let outcome: MobileNativeChatSendOutcome = 'rejected'
    await act(async () => {
      const sending = api!.sendWithOutcome(WORDS)
      await vi.runAllTimersAsync()
      outcome = await sending
    })
    return outcome
  }

  beforeEach(() => {
    vi.useFakeTimers()
    acceptSend.mockReset()
    holdUnconfirmedSend.mockReset()
    restoreRejectedDraft.mockReset()
    report.mockReset()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    api = null
    vi.useRealTimers()
  })

  // The incident's tab had Orca's prompt hook: the status carried its earlier prompts.
  const HOOKED = HOOKED_COPIES

  it('is held, not drawn as delivered, when no look at the screen could be had', async () => {
    const tab = workingTab(() => 'fail')
    mount(tab.client, HOOKED)

    expect(await send()).toBe('unknown')

    expect(tab.writes).toContain(WORDS)
    expect(acceptSend).not.toHaveBeenCalled()
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
    expect(holdUnconfirmedSend.mock.calls[0]![1]).toBe(WORDS)
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
  })

  it('is held when its words showed in the input and then left it with no row and no copy', async () => {
    // Something other than Claude's queue took them out (no `❯` row of them, no prompt copy):
    // the words leaving the input is the phone's reading, not Claude's record.
    const tab = workingTab((afterBody) => (afterBody === 0 ? busyWith(WORDS) : busyWith('')))
    mount(tab.client, HOOKED)

    expect(await send()).toBe('unknown')

    expect(acceptSend).not.toHaveBeenCalled()
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
  })

  it('is held when the words never showed at all on screens the phone did read', async () => {
    const tab = workingTab(() => busyWith(''))
    mount(tab.client, HOOKED)

    expect(await send()).toBe('unknown')

    expect(acceptSend).not.toHaveBeenCalled()
    expect(holdUnconfirmedSend).toHaveBeenCalledTimes(1)
  })
})

describe('a message sent while Claude works, that Claude took', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
  })
  afterEach(() => vi.useRealTimers())

  const write = (client: RpcClient, receipts: () => readonly BeaconPromptReceipt[], text = WORDS, hasImages = false) =>
    writeChatSend({
      agent: 'claude',
      client,
      terminal: 'codeui',
      text,
      hasImages,
      syncComposer: true,
      classification: 'chat',
      typesCodexCommand: false,
      seed: null,
      residue: null,
      deadline: Date.now() + 15_000,
      deviceToken: null,
      receipts
    })
  /** The words in the input on the first look after the body, gone on every later one, and
   *  nothing drawn above the box: the phone's reading alone. */
  const leftInputOnly = (afterBody: number): string[] => (afterBody === 0 ? busyWith(WORDS) : busyWith(''))

  it('is delivered on the prompt copy Orca puts on the tab status at the enqueue', async () => {
    const tab = workingTab(leftInputOnly)
    const copies: BeaconPromptReceipt[] = [{ nonce: 'status:s:1:0', text: 'Fix the flicker' }]
    const sending = write(tab.client, () => copies)
    // The hook's copy reaches the phone a moment after the words left the input.
    await vi.advanceTimersByTimeAsync(1_500)
    copies.push({ nonce: 'status:s:2:1', text: WORDS })
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is delivered on Claude drawing it in its queue box, with no copy (the queue row is Claude\'s)', async () => {
    const tab = workingTab((afterBody) => (afterBody < 0 ? busyWith('') : busyWith('', [WORDS])))
    const sending = write(tab.client, () => HOOKED_COPIES)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is delivered on its screen alone when it repeats the last status copy, which brings no new one', async () => {
    // The tab status keeps no second copy of the prompt it already holds, so "yes" twice can
    // bring Claude's copy only once. Held, the second would be typed a third time after the turn.
    const tab = workingTab(leftInputOnly)
    const sending = write(tab.client, () => [{ nonce: 'status:s:1:0', text: WORDS }])
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is held when its words repeat an older copy that is not the last one on the status', async () => {
    const tab = workingTab(leftInputOnly)
    const copies: BeaconPromptReceipt[] = [
      { nonce: 'status:s:1:0', text: WORDS },
      { nonce: 'status:s:2:1', text: 'Fix the flicker' }
    ]
    const sending = write(tab.client, () => copies)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('is held when it repeats the last status copy on a tab whose beacon gives every submission a copy', async () => {
    const tab = workingTab(leftInputOnly)
    const copies: BeaconPromptReceipt[] = [
      { nonce: 'status:s:1:0', text: WORDS },
      { nonce: '4242', text: WORDS }
    ]
    const sending = write(tab.client, () => copies)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('is held with no copies at all: a fresh session, a /clear and the outbox\'s own resend have none', async () => {
    // Opus re-review of 05dd008f6: reading "no copies" as "no hook" let the outbox's last try,
    // which reads no copies, call the words leaving the input delivered.
    const tab = workingTab(leftInputOnly)
    const sending = write(tab.client, () => [])
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('is held when it repeats a status copy twinned with a beacon copy (a beacon tab)', async () => {
    const tab = workingTab(leftInputOnly)
    const copies: BeaconPromptReceipt[] = [
      { nonce: 'status:s:1:0', text: WORDS, hookTwin: { nonce: '4242', anchorId: 'r1', seenAt: 1 } as never }
    ]
    const sending = write(tab.client, () => copies)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('is held when the only drawn row shares its first 40 characters with it and then says something else', async () => {
    const long = 'Can you check whether the build on main and the release branch passes the gate'
    const earlier = 'Can you check whether the build on main and the release branch is red'
    const tab = workingTab((afterBody) => (afterBody === 0 ? busyWith(long) : busyWith('', [earlier])))
    const sending = write(tab.client, () => HOOKED_COPIES, long)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('is delivered on a queue row Claude cut, a long enough start of its words', async () => {
    const long = 'Can you check whether the build on main and the release branch passes the gate'
    const tab = workingTab((afterBody) => (afterBody < 0 ? busyWith('') : busyWith('', [`${long.slice(0, 60)}…`])))
    const sending = write(tab.client, () => HOOKED_COPIES, long)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is delivered on a copy that came in while a screen read was out', async () => {
    const copies: BeaconPromptReceipt[] = [...HOOKED_COPIES]
    const tab = workingTab((afterBody) => {
      if (afterBody === 0) {
        copies.push({ nonce: 'status:s:2:1', text: WORDS })
      }
      return busyWith('')
    })
    const sending = write(tab.client, () => copies)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is delivered on the new chips-only row Claude draws for a photo with no caption', async () => {
    const tab = workingTab((afterBody) => (afterBody < 0 ? busyWith('', ['[Image #2]']) : busyWith('', ['[Image #2]', '[Image #3]'])))
    const sending = write(tab.client, () => HOOKED_COPIES, '', true)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('is held when the only chips-only row on screen is an older photo\'s', async () => {
    const tab = workingTab((afterBody) =>
      afterBody < 0 ? busyWith('', ['[Image #2]']) : afterBody === 0 ? busyWith('[Image #3]', ['[Image #2]']) : busyWith('', ['[Image #2]'])
    )
    const sending = write(tab.client, () => HOOKED_COPIES, '', true)
    await vi.runAllTimersAsync()

    expect(await sending).toEqual({ kind: 'written', outcome: 'unknown' })
  })
})

describe('what a check of the screen alone settles', () => {
  it('settles it only where Claude drew it or copied it', () => {
    expect(chatSendOutcomeOfVerdict({ kind: 'sent' }, WORDS, HOOKED_COPIES)).toBe('accepted')
    expect(chatSendOutcomeOfVerdict({ kind: 'sent', byReceipt: true }, WORDS, HOOKED_COPIES)).toBe('accepted')
    expect(chatSendOutcomeOfVerdict({ kind: 'sent', inputOnly: true }, WORDS, HOOKED_COPIES)).toBe('unknown')
    expect(chatSendOutcomeOfVerdict({ kind: 'unverified' }, WORDS, HOOKED_COPIES)).toBe('unknown')
    expect(chatSendOutcomeOfVerdict({ kind: 'unverified' }, WORDS, [])).toBe('unknown')
    expect(chatSendOutcomeOfVerdict({ kind: 'unknown' }, WORDS, HOOKED_COPIES)).toBe('unknown')
  })

  it('keeps a shell command on the rule it had: a hold would end with the outbox running it again', () => {
    expect(chatSendOutcomeOfVerdict({ kind: 'unverified' }, '!ls', HOOKED_COPIES)).toBe('accepted')
    expect(chatSendOutcomeOfVerdict({ kind: 'sent', inputOnly: true }, '!ls', HOOKED_COPIES)).toBe('accepted')
    expect(chatSendOutcomeOfVerdict({ kind: 'unknown' }, '!ls', HOOKED_COPIES)).toBe('unknown')
  })
})

describe('a held send whose prompt copy came in before the hold was parked', () => {
  // The hold's confirm effect looks only when the copies change. One that landed between the
  // check's last look and the hold would never be looked at again, and the send would wait out its
  // deadline and go to the outbox, which could type it a second time after the turn.
  const origin = (known: string[]) =>
    ({
      draftKey: 'k',
      pendingKey: 'p',
      normalizedText: normalizeReconcileText(WORDS),
      baselineTailMessageId: null,
      knownReceiptNonces: new Set(known)
    }) as never

  it('is settled at once by that copy', () => {
    const onUnconfirmed = vi.fn()
    const held = parkUnconfirmedSend({
      origin: origin(['status:s:1:0']),
      text: WORDS,
      messages: [],
      receipts: [
        { nonce: 'status:s:1:0', text: 'Fix the flicker' },
        { nonce: 'status:s:2:1', text: WORDS }
      ],
      isActiveTranscript: true,
      onUnconfirmed,
      onExpire: vi.fn()
    })
    expect(held).toBeNull()
  })

  it('is not settled by a copy of the same words the phone already had when it sent', () => {
    vi.useFakeTimers()
    const held = parkUnconfirmedSend({
      origin: origin(['status:s:1:0']),
      text: WORDS,
      messages: [],
      receipts: [{ nonce: 'status:s:1:0', text: WORDS }],
      isActiveTranscript: true,
      onUnconfirmed: vi.fn(),
      onExpire: vi.fn()
    })
    expect(held).not.toBeNull()
    clearTimeout(held!.deadline ?? undefined)
    vi.useRealTimers()
  })

  it('is not settled by a copy on another chat\'s screen', () => {
    vi.useFakeTimers()
    const held = parkUnconfirmedSend({
      origin: origin([]),
      text: WORDS,
      messages: [],
      receipts: [{ nonce: 'status:s:2:1', text: WORDS }],
      isActiveTranscript: false,
      onUnconfirmed: vi.fn(),
      onExpire: vi.fn()
    })
    expect(held).not.toBeNull()
    clearTimeout(held!.deadline ?? undefined)
    vi.useRealTimers()
  })
})

describe('a held photo with no caption', () => {
  // Opus review of 573deb5b0: a caption-less photo held for Claude's copy could never be settled
  // by one (an empty send matched no copy), so after the hold the drainer pasted it again.
  const photoOrigin = (known: string[] | undefined) =>
    ({
      draftKey: 'k',
      pendingKey: 'p',
      normalizedText: '',
      baselineTailMessageId: null,
      ...(known ? { knownReceiptNonces: new Set(known) } : {})
    }) as never
  const park = (known: string[] | undefined, receipts: BeaconPromptReceipt[]) => {
    vi.useFakeTimers()
    const held = parkUnconfirmedSend({
      origin: photoOrigin(known),
      text: '',
      messages: [],
      receipts,
      isActiveTranscript: true,
      onUnconfirmed: vi.fn(),
      onExpire: vi.fn()
    })
    if (held) {
      clearTimeout(held.deadline ?? undefined)
    }
    vi.useRealTimers()
    return held
  }

  it('is settled by a new copy of chips alone', () => {
    expect(park(['status:s:1:0'], [{ nonce: 'status:s:1:0', text: 'Fix the flicker' }, { nonce: 'status:s:2:1', text: '[Image #3]' }])).toBeNull()
  })

  it('is not settled by a chips copy the phone already had, nor by a copy with words', () => {
    expect(park(['status:s:1:0'], [{ nonce: 'status:s:1:0', text: '[Image #2]' }])).not.toBeNull()
    expect(park([], [{ nonce: 'status:s:2:1', text: '[Image #3] what is this' }])).not.toBeNull()
  })

  it('degenerate: is not settled with no record of the copies it left with', () => {
    expect(park(undefined, [{ nonce: 'status:s:2:1', text: '[Image #3]' }])).not.toBeNull()
  })

  it('is taken by the drainer as landed on a chips-only status prompt the tab did not have when it left', () => {
    const entry = (promptBefore: string) =>
      ({ normalizedText: '', hasAttachments: true, route: { promptBefore } }) as unknown as NativeChatOutboxEntry
    expect(promptIsReceiptOf(entry('Fix the flicker'), '[Image #3]')).toBe(true)
    expect(promptIsReceiptOf(entry('[Image #3]'), '[Image #3]')).toBe(false)
    expect(promptIsReceiptOf(entry('Fix the flicker'), '[Image #3] with words')).toBe(false)
  })
})
