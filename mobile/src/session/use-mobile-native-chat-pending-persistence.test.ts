import { createElement, useState, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import {
  resetHandedOnWitnessesForTests,
  useMobileNativeChatPendingPersistence
} from './use-mobile-native-chat-pending-persistence'
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

  let remember: (id: string, text: string, anchorId: string | null) => void = () => {}
  const MESSAGES = { current: [] as never[] }
  function Harness({ sessionKey }: { sessionKey: string | null }): null {
    const [state, setState] = useState<Pending>({})
    pending = state
    setPending = setState
    remember = useMobileNativeChatPendingPersistence(sessionKey, state, setState, {
      messagesRef: MESSAGES,
      draftKey: 'draft'
    }).rememberEcho
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
    resetHandedOnWitnessesForTests()
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

  // The route came back after a turn Claude took the phone's message in: the
  // hook's copy of it is remembered as a witness a moment before the stored
  // echoes are read back (reported 2026-09-25, Claude Code 2.1.282).
  // Reported 2026-09-25 (Claude Code 2.1.282): after a remount the hook's copy
  // of a stored send was remembered, in the moment before the store was read
  // back, as someone else's message, and drew under the reply that ended the
  // turn. No witness is remembered until the read is back.
  describe('a witness seen before the stored echoes are read back', () => {
    const sentAt = Date.parse('2026-09-25T17:04:15.000Z')
    const send = { ...echo('pending-1', 'check the menu'), sentAt }
    /** Holds the store's read until `release` is called. */
    function holdTheRead(): { release: () => void } {
      let release = () => {}
      const read = AsyncStorage.getItem.bind(AsyncStorage)
      const spy = vi.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
        (key) =>
          new Promise((resolve) => {
            release = () => {
              spy.mockRestore()
              void read(key).then(resolve)
            }
          })
      )
      return { release: () => release() }
    }

    it('drops one that copies a stored send once the read is back, and stores the next one at once', async () => {
      await writeNativeChatPendingEchoes('s1', [send])
      const read = holdTheRead()
      await mount('s1')
      act(() => remember('desk-status:s1:1:0', 'check the menu', 'm9'))
      await flush()
      expect(pending.s1).toBeUndefined()
      read.release()
      await flush()
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1'])
      act(() => remember('desk-status:s1:2:0', 'typed at the desk', 'm9'))
      await flush()
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1', 'desk-status:s1:2:0'])
    })

    it('keeps one of another message, held while the read was out, once it is back', async () => {
      await writeNativeChatPendingEchoes('s1', [send])
      const read = holdTheRead()
      await mount('s1')
      act(() => remember('desk-status:s1:1:0', 'typed at the desk', 'm9'))
      read.release()
      await flush()
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1', 'desk-status:s1:1:0'])
    })

    // Review, 2026-09-25: the route went away before a slow read came back, and
    // the desk's message, seen only then, was never kept.
    it('writes one held while the read was out through to the store when the chat goes away first', async () => {
      await writeNativeChatPendingEchoes('s1', [send])
      const read = holdTheRead()
      await mount('s1')
      act(() => remember('desk-status:s1:1:0', 'typed at the desk', 'm9'))
      act(() => renderer?.unmount())
      renderer = null
      read.release()
      await flush()
      await flush()
      expect((await readNativeChatPendingEchoes('s1'))?.map((item) => item.id)).toEqual([
        'pending-1',
        'desk-status:s1:1:0'
      ])
    })

    it('is remembered once a session with nothing stored has been read', async () => {
      await mount('s1')
      await flush()
      act(() => remember('desk-status:s1:1:0', 'typed at the desk', 'm9'))
      await flush()
      expect(pending.s1?.map((item) => item.id)).toEqual(['desk-status:s1:1:0'])
    })

    it('is remembered when the store could not be read at all', async () => {
      const spy = vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('store unreadable'))
      await mount('s1')
      await flush()
      spy.mockRestore()
      act(() => remember('desk-status:s1:1:0', 'typed at the desk', 'm9'))
      await flush()
      expect(pending.s1?.map((item) => item.id)).toEqual(['desk-status:s1:1:0'])
    })
  })

  it('keeps an optimistic bubble that was made just before the screen closed', async () => {
    // Same shape as the composer draft (2026-09-13): the write waited out its
    // debounce and unmounting inside that window cancelled it, so a message sent
    // right before leaving the chat had no stored bubble to come back to.
    await mount('s1')
    act(() => setPending({ s1: [echo('p1', 'sent as the screen closed')] }))
    act(() => renderer?.unmount())
    renderer = null
    await flush()
    expect(await readNativeChatPendingEchoes('s1')).toHaveLength(1)
  })
})
