import { createElement, useState, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import {
  resetHandedOnWitnessesForTests,
  useMobileNativeChatPendingPersistence
} from './use-mobile-native-chat-pending-persistence'
import { readNativeChatPendingEchoes, writeNativeChatPendingEchoes } from '../storage/native-chat-pending-echoes'

// A session's pending echoes sit under one key, so each write is the whole
// list. A read AsyncStorage refused came back as "nothing stored": the chat
// marked itself read with nothing, and the next debounced write put only this
// visit's list over the stored one. That erased the echo of a message queued
// while the agent was busy, which is the only copy of it (2026-09-30). The
// refusal is driven for real here: getItem rejects.

type Pending = Record<string, MobileNativeChatPendingMessage[]>

const echo = (id: string, text: string): MobileNativeChatPendingMessage => ({
  id,
  text,
  expectedOccurrence: 1,
  baselineTailMessageId: 'm9',
  baselineResolved: true
})

const QUEUED = echo('q1', 'queued while the agent was busy')
const SENT = echo('p2', 'sent on this visit')

describe('a visit whose read of the stored echoes was refused', () => {
  let renderer: ReactTestRenderer | null = null
  let pending: Pending = {}
  let setPending: Dispatch<SetStateAction<Pending>> = () => {}
  let warn: MockInstance<typeof console.warn>
  function Harness({ sessionKey, initial = {} }: { sessionKey: string; initial?: Pending }): null {
    const [state, setState] = useState<Pending>(initial)
    pending = state
    setPending = setState
    useMobileNativeChatPendingPersistence(sessionKey, state, setState, {
      messagesRef: { current: [] },
      draftKey: 'draft'
    })
    return null
  }
  async function mount(initial?: Pending): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { sessionKey: 's1', initial }))
    })
  }
  const flush = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })
    }
  }
  const send = (): void => {
    act(() => setPending((previous) => ({ s1: [...(previous.s1 ?? []), SENT] })))
  }
  const stored = async (): Promise<string[] | undefined> =>
    (await readNativeChatPendingEchoes('s1'))?.map((item) => item.id)
  const refuseReads = (times?: number): MockInstance => {
    const spy = vi.spyOn(AsyncStorage, 'getItem')
    if (times === undefined) {
      return spy.mockRejectedValue(new Error('storage unavailable'))
    }
    for (let time = 0; time < times; time += 1) {
      spy.mockRejectedValueOnce(new Error('storage unavailable'))
    }
    return spy
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    await AsyncStorage.clear()
    resetHandedOnWitnessesForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps the queued message stored before it, and brings it back once the store reads again', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    refuseReads(1)
    await mount()
    await flush()
    send()
    await flush()
    expect(await stored()).toEqual(['q1', 'p2'])
    expect(pending.s1?.map((item) => item.id)).toEqual(['q1', 'p2'])
  })

  it('writes nothing over the stored list while the store keeps refusing, and says why', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    const reads = refuseReads()
    await mount()
    await flush()
    send()
    await flush()
    expect(pending.s1?.map((item) => item.id)).toEqual(['p2'])
    reads.mockRestore()
    expect(await stored()).toEqual(['q1'])
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes('could not read the chat pending echoes'))).toHaveLength(1)
    expect(lines.filter((line) => line.includes('could not save the chat pending echoes'))).toHaveLength(1)
  })

  it('writes nothing over the stored list from a send made before the refused read came back', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    let refuse: () => void = () => undefined
    const reads = vi
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((_resolve, reject) => {
            refuse = () => reject(new Error('storage unavailable'))
          })
      )
      .mockRejectedValue(new Error('storage unavailable'))
    await mount()
    send()
    await flush()
    refuse()
    await flush()
    reads.mockRestore()
    expect(await stored()).toEqual(['q1'])
  })

  it('keeps the stored list when the chat closes right after a send, with the store still refusing', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    const reads = refuseReads()
    await mount()
    await flush()
    send()
    act(() => renderer?.unmount())
    renderer = null
    await flush()
    reads.mockRestore()
    expect(await stored()).toEqual(['q1'])
  })

  it('writes this visit over the stored list merged, when the chat closes after the store reads again', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    refuseReads(1)
    await mount()
    await flush()
    send()
    act(() => renderer?.unmount())
    renderer = null
    await flush()
    expect(await stored()).toEqual(['q1', 'p2'])
  })

  // The failure path of the wait: a chat whose list was emptied while it was
  // away (every echo retired) still erases the stored copy when the read
  // comes back, rather than bringing retired bubbles back (be57035c).
  it('still erases the stored list a slow read finds when the chat had emptied its own', async () => {
    await writeNativeChatPendingEchoes('s1', [QUEUED])
    let release: () => void = () => undefined
    const read = AsyncStorage.getItem.bind(AsyncStorage)
    const reads = vi.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      (key) =>
        new Promise((resolve) => {
          release = () => void read(key).then(resolve)
        })
    )
    await mount({ s1: [] })
    await flush()
    reads.mockRestore()
    release()
    await flush()
    expect(pending.s1).toEqual([])
    expect(await stored()).toBeUndefined()
  })

  // Nothing to keep: a refused read of an empty store, or a store that holds
  // no list it can parse, costs nothing once a read succeeds.
  it('writes the visit alone over a store with nothing in it, or one it cannot parse', async () => {
    refuseReads(1)
    await mount()
    await flush()
    send()
    await flush()
    expect(await stored()).toEqual(['p2'])
    act(() => renderer?.unmount())
    renderer = null
    await AsyncStorage.setItem(`orca:chatPendingEchoes:${encodeURIComponent('s1')}`, '{not json')
    await mount()
    await flush()
    act(() => setPending({ s1: [SENT] }))
    await flush()
    expect(await stored()).toEqual(['p2'])
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('could not save'))).toEqual([])
  })
})
