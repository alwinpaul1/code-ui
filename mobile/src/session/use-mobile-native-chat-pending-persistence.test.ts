import { createElement, useState, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { useMobileNativeChatPendingPersistence } from './use-mobile-native-chat-pending-persistence'
import {
  PENDING_ECHO_MAX_AGE_MS,
  readNativeChatPendingEchoes,
  writeNativeChatPendingEchoes
} from '../storage/native-chat-pending-echoes'

type Pending = Record<string, MobileNativeChatPendingMessage[]>

const echo = (id: string, text: string, images?: string[]): MobileNativeChatPendingMessage => ({
  id,
  text,
  expectedOccurrence: 1,
  baselineTailMessageId: 'm9',
  baselineResolved: true,
  ...(images ? { images } : {})
})

describe('useMobileNativeChatPendingPersistence', () => {
  let renderer: ReactTestRenderer | null = null
  let pending: Pending = {}
  let setPending: Dispatch<SetStateAction<Pending>> = () => {}

  function Harness({ sessionKey }: { sessionKey: string | null }): null {
    const [state, setState] = useState<Pending>({})
    pending = state
    setPending = setState
    useMobileNativeChatPendingPersistence(sessionKey, state, setState)
    return null
  }
  async function mount(sessionKey: string | null): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { sessionKey }))
    })
  }
  const flush = async (): Promise<void> => {
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    await AsyncStorage.clear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('brings a queued echo (with its photo) back after the route remounts', async () => {
    await mount('s1')
    act(() =>
      setPending({ s1: [echo('p1', 'Make the x not touch the image', ['file:///shot.png'])] })
    )
    await flush()
    act(() => renderer?.unmount())
    renderer = null
    await mount('s1')
    await flush()
    expect(pending.s1?.map((item) => [item.id, item.text, item.images])).toEqual([
      ['p1', 'Make the x not touch the image', ['file:///shot.png']]
    ])
  })

  it('keeps a stored echo ahead of a send appended after it', async () => {
    await writeNativeChatPendingEchoes('s1', [echo('old', 'first')])
    await mount('s1')
    // The send path appends (see appendMobileNativeChatPending); it never replaces.
    act(() => setPending((previous) => ({ s1: [...(previous.s1 ?? []), echo('new', 'second')] })))
    await flush()
    expect(pending.s1?.map((item) => item.id)).toEqual(['old', 'new'])
    expect(await readNativeChatPendingEchoes('s1')).toHaveLength(2)
  })

  it('drops a stored list older than a day', async () => {
    const then = Date.now() - PENDING_ECHO_MAX_AGE_MS - 1
    await writeNativeChatPendingEchoes('s1', [echo('stale', 'gone')], then)
    expect(await readNativeChatPendingEchoes('s1')).toBeNull()
  })

  it('removes the entry once every echo retired', async () => {
    await mount('s1')
    act(() => setPending({ s1: [echo('p1', 'hi')] }))
    await flush()
    act(() => setPending({ s1: [] }))
    await flush()
    expect(await AsyncStorage.getAllKeys()).toEqual([])
  })
})
