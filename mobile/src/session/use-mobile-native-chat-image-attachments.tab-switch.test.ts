import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

import {
  baseArgs,
  makeClient,
  methodNotFound,
  ok,
  SCOPE_A,
  SCOPE_B,
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

// A composer send takes the tab it was tapped on, then waits: for a chip to
// upload, for the relay, for its look at the screen. A text-only send handed
// its text to the message send, which reads the CURRENT tab, with no check
// that it was still the one tapped, so a tab switch in that wait typed the
// message into the other tab's agent; a send with a photo pasted it there
// (found by the Opus review of the send fix, 2026-10-02). The send now refuses
// instead, and keeps the draft.

describe('a composer send when the tab changes while it waits', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    pick.mockReset()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  function mount(args: HookArgs): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }

  /** A look at the screen that stays open until `release`, so the test can act while the send waits on it. */
  function holdLook(): { look: () => Promise<null>; release: () => void } {
    let release: () => void = () => {}
    const held = new Promise<null>((resolve) => {
      release = () => resolve(null)
    })
    return { look: () => held, release }
  }

  /** Taps send, switches to the other tab while the send waits on its look, lets the look finish. */
  async function sendSwitchingTabsDuringLook(
    args: HookArgs,
    look: { release: () => void },
    text: string
  ): Promise<boolean> {
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      sending = hook!.sendNativeChat(text)
      for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve()
      }
    })
    // The other tab's terminal, and the composer's scope: what a tab switch changes.
    ;(args.activeHandleRef as { current: string | null }).current = 'term-2'
    act(() => {
      renderer!.update(createElement(Harness, { args: { ...args, scopeKey: SCOPE_B } }))
    })
    let sent = true
    await act(async () => {
      look.release()
      sent = await sending
    })
    return sent
  }

  it('does not send a text message to the tab switched to during its look', async () => {
    const activeHandleRef = { current: 'term-1' as string | null }
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const onSendError = vi.fn()
    const client = makeClient([])
    const held = holdLook()
    const args = baseArgs({
      client: client as unknown as RpcClient,
      activeHandleRef,
      baseSend,
      onSendError,
      refuseUnderDialog: held.look
    })
    mount(args)
    const sent = await sendSwitchingTabsDuringLook(args, held, 'deploy the staging build')
    expect(sent).toBe(false)
    expect(baseSend).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent (session changed)')
  })

  it('does not paste a photo into the tab switched to during its look, and keeps the chip', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const activeHandleRef = { current: 'term-1' as string | null }
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const onSendError = vi.fn()
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    const held = holdLook()
    let look: () => Promise<null> = async () => null
    const args = baseArgs({
      client: client as unknown as RpcClient,
      activeHandleRef,
      baseSend,
      onSendError,
      refuseUnderDialog: () => look()
    })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })
    look = held.look
    const sent = await sendSwitchingTabsDuringLook(args, held, 'this one')
    expect(sent).toBe(false)
    expect(client.calls.filter((call) => call.method === 'terminal.send')).toEqual([])
    expect(baseSend).not.toHaveBeenCalled()
    // The chip stays with the tab that picked it.
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A]).toHaveLength(1)
    expect(onSendError).toHaveBeenCalledWith('Message not sent (session changed)')
  })

  it('does not send the text into the tab switched to while the photo\'s paste settles', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(true) // image paste, into term-1
    ])
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const onSendError = vi.fn()
    const activeHandleRef = { current: 'term-1' as string | null }
    let releaseSettle: (() => void) | null = null
    const args = baseArgs({
      client: client as unknown as RpcClient,
      activeHandleRef,
      baseSend,
      onSendError,
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSettle = resolve
        })
    })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      sending = hook!.sendNativeChat('hi')
      for (let turn = 0; turn < 50 && !releaseSettle; turn++) {
        await Promise.resolve()
      }
    })
    expect(releaseSettle).not.toBeNull()
    // The user switches tabs while the paste settles: the text + Enter must not
    // land in term-2 when the images went to term-1.
    activeHandleRef.current = 'term-2'
    act(() => {
      renderer!.update(createElement(Harness, { args: { ...args, scopeKey: SCOPE_B } }))
    })
    let sent = true
    await act(async () => {
      releaseSettle!()
      sent = await sending
    })
    expect(sent).toBe(false)
    expect(baseSend).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent')
    // The chip stays with the tab that picked it.
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A]).toHaveLength(1)
  })

  it('still sends on the tab it was tapped on when nothing changed', async () => {
    const activeHandleRef = { current: 'term-1' as string | null }
    const baseSend = vi.fn().mockResolvedValue('accepted')
    mount(baseArgs({ client: makeClient([]) as unknown as RpcClient, activeHandleRef, baseSend }))
    let sent = false
    await act(async () => {
      sent = await hook!.sendNativeChat('deploy the staging build')
    })
    expect(sent).toBe(true)
    expect(baseSend).toHaveBeenCalledTimes(1)
  })

  // Degenerate: a terminal tab that had no terminal and still has none is no
  // switch; the message send says why it cannot go, as before.
  it('hands a terminal tab with no terminal, before or after, to the message send', async () => {
    const activeHandleRef = { current: null as string | null }
    const baseSend = vi.fn().mockResolvedValue('rejected')
    const onSendError = vi.fn()
    mount(baseArgs({ client: makeClient([]) as unknown as RpcClient, activeHandleRef, baseSend, onSendError }))
    await act(async () => {
      await hook!.sendNativeChat('hello')
    })
    expect(baseSend).toHaveBeenCalledTimes(1)
    expect(onSendError).not.toHaveBeenCalledWith('Message not sent (session changed)')
  })

  // Degenerate: a structured chat has no terminal to switch from, and a tab
  // that had none and still has none is no switch.
  it('sends when there was no terminal and still is none', async () => {
    const activeHandleRef = { current: null as string | null }
    const baseSend = vi.fn().mockResolvedValue('accepted')
    mount(
      baseArgs({
        client: makeClient([]) as unknown as RpcClient,
        activeHandleRef,
        baseSend,
        structuredNativeChat: true
      })
    )
    let sent = false
    await act(async () => {
      sent = await hook!.sendNativeChat('hello')
    })
    expect(sent).toBe(true)
    expect(baseSend).toHaveBeenCalledTimes(1)
  })
})
