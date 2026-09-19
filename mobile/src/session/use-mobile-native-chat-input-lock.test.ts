// Upstream's test for the same settle hook (Orca #19695 extracted it from the
// view as `useSettledMobileNativeChatInputLock`; this fork had already moved it
// here as `useMobileNativeChatInputLock`), adapted to the fork's name.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatInputLock } from './use-mobile-native-chat-input-lock'

describe('useMobileNativeChatInputLock', () => {
  let renderer: ReactTestRenderer | null = null
  let settled: ReturnType<typeof useMobileNativeChatInputLock> | undefined

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function Harness({ reason }: { reason: 'waiting' | 'disconnected' | null }): null {
    settled = useMobileNativeChatInputLock(reason)
    return null
  }

  it('holds each edge until the lease has stopped flapping', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(Harness, { reason: 'waiting' }))
    })
    expect(settled).toBeNull()
    act(() => vi.advanceTimersByTime(600))
    expect(settled).toBe('waiting')

    // A brief unlock that reverts inside the settle window never reaches the composer.
    act(() => renderer?.update(createElement(Harness, { reason: null })))
    act(() => vi.advanceTimersByTime(300))
    act(() => renderer?.update(createElement(Harness, { reason: 'disconnected' })))
    act(() => vi.advanceTimersByTime(600))
    expect(settled).toBe('disconnected')

    act(() => renderer?.update(createElement(Harness, { reason: null })))
    act(() => vi.advanceTimersByTime(600))
    expect(settled).toBeNull()
  })
})
