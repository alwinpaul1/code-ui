import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'

it.each(['claude', 'codex'])(
  'opens the original %s terminal after draft writes settle, without replaying queue text',
  async (agent) => {
    const peek = vi.fn()
    let settle!: () => void
    const beforeOpen = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    const handleRef = { current: 'desktop-terminal' }
    let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
    function Harness({ peeking = false, tabId = 'tab' }) {
      api = useMobileNativeChatQueueEditor({
        agent: peeking ? null : agent,
        tabId,
        handleRef,
        enabled: !peeking,
        peeking,
        beforeOpen,
        peek,
        onError: vi.fn()
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let opened!: Promise<void>
    act(() => {
      opened = api.open()
    })
    expect(peek).not.toHaveBeenCalled()
    await act(async () => {
      settle()
      await opened
    })
    expect(peek).toHaveBeenCalledExactlyOnceWith('tab')
    await act(async () => renderer.update(createElement(Harness, { peeking: true })))
    expect(api.agent).toBe(agent)
    await act(async () =>
      renderer.update(createElement(Harness, { peeking: true, tabId: 'other' }))
    )
    expect(api.agent).toBeNull()
    await act(async () => renderer.unmount())
  }
)

it.each(['tab', 'handle', 'unmount'])(
  'does not open a stale queue editor after %s changes',
  async (change) => {
    const peek = vi.fn()
    const handleRef = { current: 'terminal' }
    let settle!: () => void
    const beforeOpen = () =>
      new Promise<void>((resolve) => {
        settle = resolve
      })
    let api!: ReturnType<typeof useMobileNativeChatQueueEditor>
    function Harness({ tabId = 'tab' }) {
      api = useMobileNativeChatQueueEditor({
        agent: 'codex',
        tabId,
        handleRef,
        enabled: true,
        peeking: false,
        beforeOpen,
        peek,
        onError: vi.fn()
      })
      return null
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let opened!: Promise<void>
    act(() => {
      opened = api.open()
    })
    await act(async () => {
      if (change === 'tab') {
        renderer.update(createElement(Harness, { tabId: 'other' }))
      }
      if (change === 'handle') {
        handleRef.current = 'other'
      }
      if (change === 'unmount') {
        renderer.unmount()
      }
    })
    await act(async () => {
      settle()
      await opened
    })
    expect(peek).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  }
)
