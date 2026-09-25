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

  function Harness({ sessionKey, initial = {} }: { sessionKey: string | null; initial?: Pending }): null {
    const [state, setState] = useState<Pending>(initial)
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

  // The route came back after a turn Claude took the phone's message in: the
  // hook's copy of it is remembered as a witness a moment before the stored
  // echoes are read back (reported 2026-09-25, Claude Code 2.1.282).
  describe('a witness remembered before the stored echoes came back', () => {
    const sentAt = Date.parse('2026-09-25T17:04:15.000Z')
    const send = { ...echo('pending-1', 'check the menu'), sentAt }
    const witness = (text: string, witnessedAt: number): MobileNativeChatPendingMessage => ({
      ...echo('desk-status:s1:1:0', text),
      witnessedAt
    })
    /** The live list already holds the witness when the stored read starts. */
    async function mountWithLive(live: MobileNativeChatPendingMessage[]): Promise<void> {
      await act(async () => {
        renderer = create(createElement(Harness, { sessionKey: 's1', initial: { s1: live } }))
      })
      await flush()
    }

    it('drops the copy of a stored send, so the send is drawn once', async () => {
      await writeNativeChatPendingEchoes('s1', [send])
      await mountWithLive([witness('check the menu', sentAt + 300_000)])
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1'])
    })

    it('keeps a witness of another message, and one remembered before the send left the phone', async () => {
      await writeNativeChatPendingEchoes('s1', [send])
      await mountWithLive([witness('something else', sentAt + 300_000)])
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1', 'desk-status:s1:1:0'])
      act(() => renderer?.unmount())
      renderer = null
      await AsyncStorage.clear()
      await writeNativeChatPendingEchoes('s1', [send])
      await mountWithLive([witness('check the menu', sentAt - 1)])
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1', 'desk-status:s1:1:0'])
    })

    it('keeps the witness beside a stored send from a build that kept no send time', async () => {
      await writeNativeChatPendingEchoes('s1', [echo('pending-1', 'check the menu')])
      await mountWithLive([witness('check the menu', sentAt)])
      expect(pending.s1?.map((item) => item.id)).toEqual(['pending-1', 'desk-status:s1:1:0'])
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
