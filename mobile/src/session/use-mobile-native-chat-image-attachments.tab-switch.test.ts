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

  /** The look at the screen the send makes before it writes, during which the user switches tabs. */
  const switchesDuringLook = (activeHandleRef: { current: string | null }) => async () => {
    activeHandleRef.current = 'term-2'
    return null
  }

  it('does not send a text message to the tab switched to during its look', async () => {
    const activeHandleRef = { current: 'term-1' as string | null }
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const onSendError = vi.fn()
    const client = makeClient([])
    mount(
      baseArgs({
        client: client as unknown as RpcClient,
        activeHandleRef,
        baseSend,
        onSendError,
        refuseUnderDialog: switchesDuringLook(activeHandleRef)
      })
    )
    let sent = true
    await act(async () => {
      sent = await hook!.sendNativeChat('deploy the staging build')
    })
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
    let switchOnLook = false
    mount(
      baseArgs({
        client: client as unknown as RpcClient,
        activeHandleRef,
        baseSend,
        onSendError,
        refuseUnderDialog: async () => {
          if (switchOnLook) {
            activeHandleRef.current = 'term-2'
          }
          return null
        }
      })
    )
    await act(async () => {
      await hook!.attachImage('library')
    })
    switchOnLook = true
    let sent = true
    await act(async () => {
      sent = await hook!.sendNativeChat('this one')
    })
    expect(sent).toBe(false)
    expect(client.calls.filter((call) => call.method === 'terminal.send')).toEqual([])
    expect(baseSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toHaveLength(1)
    expect(onSendError).toHaveBeenCalledWith('Message not sent (session changed)')
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
