import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { usePendingImageHistory } from './use-pending-image-history'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  vi.useRealTimers()
})
it('pages older history for unmatched photos and stops once reconciled', async () => {
  vi.useFakeTimers()
  const loadEarlier = vi.fn()
  const session: MobileNativeChatSession = {
    messages: [],
    status: 'ready',
    transcriptLoading: false,
    hasMore: true,
    loadingEarlier: false,
    loadEarlier
  }
  function Harness({ pending }: { pending: { id: string; images?: string[] }[] }) {
    usePendingImageHistory(session, pending, 'session-a')
    return null
  }
  await act(async () => {
    renderer = create(
      createElement(Harness, { pending: [{ id: 'photo', images: ['file:///photo.jpg'] }] })
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(loadEarlier).toHaveBeenCalledTimes(1)
  await act(async () => {
    renderer!.update(createElement(Harness, { pending: [] }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(loadEarlier).toHaveBeenCalledTimes(1)
})
