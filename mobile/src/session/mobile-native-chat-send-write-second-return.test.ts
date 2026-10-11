// When the words of a send are still in Claude's input at the end of the submit check, the send
// presses Return once more (7872fddf2). The Opus review of that commit found the Return could go
// where it must not: into a permission dialog raised during the check (selecting "1. Yes"), over
// words the user typed after the send (the draft mirror appends them, gluing two messages), over
// a draft Orca had not yet caught up on, and that a review notice after it was swallowed. The
// second Return now goes only when, holding the terminal's write lock, two looks apart show
// Claude's input holding exactly this send's words and nothing else, with no dialog or notice.
//
// Screens: Claude Code 2.1.287 composer fixtures (fixtures/claude-composer-2.1.287.ts, a real
// capture's shape) and Claude Code 2.1.283's permission prompt, captured on the desktop
// 2026-09-27 (fixtures/claude-screen-subagent-bash-permission-2.1.283.txt).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'
import { writeChatSend } from './mobile-native-chat-send-write'
import {
  AFTER_REVIEW_NOTICE,
  EMPTY_COMPOSER,
  composerWithTextInDraft,
  composerWithTextInRows
} from './fixtures/claude-composer-2.1.287'
import {
  acquireMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'

const PERMISSION = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-subagent-bash-permission-2.1.283.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
  .filter((line) => !line.startsWith('# '))

/** Claude Code 2.1.295's idle box as captured (Orca's detector drew it bare), with its rules. */
const CAPTURED_IDLE = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
  .filter((line) => !line.startsWith('# '))

const TEXT = 'deploy the build when the tests pass'
type Screen = { lines: string[]; draft: string }
const words = (text = TEXT): Screen => ({ lines: composerWithTextInRows(text), draft: '' })

/**
 * A desk whose Return after the body is dropped: the words stay in the input. `after(n)` is the
 * screen on the n-th look after the body went out (0-based); before the body, an empty box.
 */
function desk(after: (look: number) => Screen) {
  let bodySent = false
  let looks = 0
  const sends: { text: string; enter: boolean }[] = []
  const client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (method === 'terminal.read') {
        const screen = bodySent ? after(looks++) : { lines: EMPTY_COMPOSER, draft: '' }
        return ok('r', { terminal: { source: 'screen', tail: screen.lines, draft: screen.draft } })
      }
      if (method === 'terminal.send') {
        sends.push({ text: params.text ?? '', enter: params.enter === true })
        if (params.enter === true && (params.text ?? '') !== '') {
          bodySent = true
        }
        return ok('s', { send: { accepted: true } })
      }
      return ok('x', null)
    })
  } as unknown as RpcClient
  return { client, sends, bareReturns: () => sends.filter((send) => send.enter && send.text === '').length }
}

async function send(client: RpcClient, receipts: () => readonly BeaconPromptReceipt[] = () => []) {
  const written = writeChatSend({
    agent: 'claude',
    client,
    terminal: 'term-1',
    text: TEXT,
    hasImages: false,
    syncComposer: true,
    classification: 'chat',
    typesCodexCommand: false,
    seed: null,
    residue: null,
    deadline: Date.now() + 15_000,
    deviceToken: null,
    receipts
  })
  await vi.advanceTimersByTimeAsync(60_000)
  return written
}

afterEach(() => {
  vi.useRealTimers()
  resetMobileNativeChatTerminalWritesForTests()
  resetMobileNativeChatStaleInputForTests()
})

describe('the second Return after a dropped one', () => {
  it('goes once, and the send counts as sent, when the input holds exactly its words', async () => {
    vi.useFakeTimers()
    let pressed = false
    const d = desk(() => (pressed ? { lines: EMPTY_COMPOSER, draft: '' } : words()))
    const original = d.client.sendRequest
    d.client.sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      const answer = await (original as (m: string, p: unknown) => Promise<unknown>)(method, params)
      if (method === 'terminal.send' && params.enter === true && params.text === '') {
        pressed = true
      }
      return answer
    }) as never
    // Claude takes it on that Return, and its prompt hook says so.
    const copies = () => (pressed ? [{ nonce: 'status:s:1', text: TEXT }] : [])
    await expect(send(d.client, copies)).resolves.toEqual({ kind: 'written', outcome: 'accepted' })
    expect(d.bareReturns()).toBe(1)
  })

  it('goes once, and the send is held for Claude\'s record, when only the screen says it went', async () => {
    vi.useFakeTimers()
    let pressed = false
    const d = desk(() => (pressed ? { lines: EMPTY_COMPOSER, draft: '' } : words()))
    const original = d.client.sendRequest
    d.client.sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      const answer = await (original as (m: string, p: unknown) => Promise<unknown>)(method, params)
      if (method === 'terminal.send' && params.enter === true && params.text === '') {
        pressed = true
      }
      return answer
    }) as never
    await expect(send(d.client)).resolves.toEqual({ kind: 'written', outcome: 'unknown' })
    expect(d.bareReturns()).toBe(1)
  })

  it('does not go into a permission dialog raised during the check', async () => {
    vi.useFakeTimers()
    const d = desk((look) => (look < 2 ? words() : { lines: PERMISSION, draft: '' }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('does not go when a dialog comes up between the check and the Return', async () => {
    vi.useFakeTimers()
    // The check's looks all show the words; the look the Return itself takes shows the dialog.
    let checks = 0
    const d = desk(() => (checks++ < 8 ? words() : { lines: PERMISSION, draft: '' }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('does not submit words typed after the send, glued onto its own', async () => {
    vi.useFakeTimers()
    const d = desk(() => words(`${TEXT} and also check the logs`))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('does not go on a draft Orca has not caught up on, over an empty box', async () => {
    vi.useFakeTimers()
    const d = desk(() => ({ lines: EMPTY_COMPOSER, draft: TEXT }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  // Re-review of a4ac1625a: the bare-prompt-plus-draft shape is MODELLED, and a captured idle
  // box draws a bare "❯" too (claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt), so a
  // draft alone cannot tell words in the box from a draft Orca has not caught up on.
  it('does not go on words that are only in the draft, even over a bare prompt', async () => {
    vi.useFakeTimers()
    const d = desk(() => ({ lines: composerWithTextInDraft(), draft: TEXT }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('does not go on a lagging draft over the captured idle box', async () => {
    vi.useFakeTimers()
    const d = desk(() => ({ lines: CAPTURED_IDLE, draft: TEXT }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('does not take a stray bare prompt elsewhere on the screen for the box', async () => {
    vi.useFakeTimers()
    const d = desk(() => ({ lines: ['❯', ...EMPTY_COMPOSER], draft: TEXT }))
    await send(d.client)
    expect(d.bareReturns()).toBe(0)
  })

  it('lets the terminal go once its Return is taken, so a permission tap during its check is not refused', async () => {
    vi.useFakeTimers()
    let pressedAt: number | null = null
    let freeDuringCheck: boolean | null = null
    const d = desk(() => {
      if (pressedAt !== null && freeDuringCheck === null) {
        freeDuringCheck = acquireMobileNativeChatTerminalWrite('term-1')
      }
      return pressedAt !== null ? { lines: EMPTY_COMPOSER, draft: '' } : words()
    })
    const original = d.client.sendRequest
    d.client.sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      const answer = await (original as (m: string, p: unknown) => Promise<unknown>)(method, params)
      if (method === 'terminal.send' && params.enter === true && params.text === '') {
        pressedAt = Date.now()
      }
      return answer
    }) as never
    await send(d.client)
    expect(d.bareReturns()).toBe(1)
    expect(freeDuringCheck).toBe(true)
  })

  it('does not go while another input holds the terminal', async () => {
    vi.useFakeTimers()
    const d = desk(() => words())
    const sending = writeChatSend({
      agent: 'claude',
      client: d.client,
      terminal: 'term-1',
      text: TEXT,
      hasImages: false,
      syncComposer: true,
      classification: 'chat',
      typesCodexCommand: false,
      seed: null,
      residue: null,
      deadline: Date.now() + 15_000,
      deviceToken: null,
      receipts: () => []
    })
    // A permission tap takes the terminal once the body is written (the send lets it go then).
    await vi.advanceTimersByTimeAsync(2_000)
    expect(acquireMobileNativeChatTerminalWrite('term-1')).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    await sending
    expect(d.bareReturns()).toBe(0)
  })

  it('says Claude’s review notice when it answers the second Return with one', async () => {
    vi.useFakeTimers()
    let pressed = false
    const d = desk(() => (pressed ? { lines: AFTER_REVIEW_NOTICE, draft: '' } : words()))
    const original = d.client.sendRequest
    d.client.sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      const answer = await (original as (m: string, p: unknown) => Promise<unknown>)(method, params)
      if (method === 'terminal.send' && params.enter === true && params.text === '') {
        pressed = true
      }
      return answer
    }) as never
    const written = await send(d.client)
    expect(written.kind).toBe('stopped')
  })
})
