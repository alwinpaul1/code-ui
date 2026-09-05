import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NATIVE_CHAT_INPUT_LEASE_GRACE_MS,
  useMobileNativeChatInputLease
} from './use-mobile-native-chat-input-lease'

type Lease = ReturnType<typeof useMobileNativeChatInputLease>

describe('useMobileNativeChatInputLease', () => {
  let renderer: ReactTestRenderer | null = null
  let lease: Lease | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    lease = null
  })

  function Harness({ connected }: { connected: boolean }): null {
    lease = useMobileNativeChatInputLease({ activeHandle: 'terminal', connected })
    return null
  }

  it('unlocks only after acknowledgement and clears on disconnect', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { connected: true }))
    })
    expect(lease?.ready).toBe(false)
    expect(lease?.lockReason).toBe('waiting')
    act(() => lease?.markReady('terminal'))
    expect(lease?.ready).toBe(true)
    expect(lease?.lockReason).toBeNull()

    act(() => lease?.clear())
    expect(lease?.ready).toBe(false)
    act(() => lease?.markReady('terminal'))
    expect(lease?.ready).toBe(true)

    await act(async () => renderer?.update(createElement(Harness, { connected: false })))
    expect(lease?.ready).toBe(false)
    expect(lease?.lockReason).toBe('disconnected')
  })

  it('reports whether a clear actually dropped a lease', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { connected: true }))
    })
    // The route reads this to tell a real teardown from one React never sees.
    expect(lease?.clear('terminal')).toBe(false)
    expect(lease?.clear()).toBe(false)

    act(() => lease?.markReady('terminal'))
    let dropped: boolean | undefined
    act(() => {
      dropped = lease?.clear('terminal')
    })
    expect(dropped).toBe(true)
    expect(lease?.ready).toBe(false)
    expect(lease?.clear('terminal')).toBe(false)

    act(() => lease?.markReady('other'))
    expect(lease?.clear()).toBe(true)
  })

  it('presumes the lease once the acknowledgement is overdue, and drops it on disconnect', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => {
        renderer = create(createElement(Harness, { connected: true }))
      })
      expect(lease?.ready).toBe(false)
      act(() => vi.advanceTimersByTime(NATIVE_CHAT_INPUT_LEASE_GRACE_MS - 1))
      expect(lease?.ready).toBe(false)
      act(() => vi.advanceTimersByTime(1))
      expect(lease?.ready).toBe(true)
      expect(lease?.lockReason).toBeNull()

      await act(async () => renderer?.update(createElement(Harness, { connected: false })))
      expect(lease?.ready).toBe(false)
      expect(lease?.lockReason).toBe('disconnected')
    } finally {
      vi.useRealTimers()
    }
  })
})
