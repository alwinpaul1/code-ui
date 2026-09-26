import { createElement, useState, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatImagePreviewPersistence } from './use-mobile-native-chat-image-preview-persistence'
import {
  hydrateNativeChatImagePreviewCache,
  resetNativeChatImagePreviewCacheForTests,
  saveNativeChatImagePreviews
} from './mobile-native-chat-image-preview-cache'

type Previews = Record<string, Record<string, string[]>>

describe('useMobileNativeChatImagePreviewPersistence', () => {
  let renderer: ReactTestRenderer | null = null
  let previews: Previews = {}
  let setPreviews: Dispatch<SetStateAction<Previews>> = () => {}

  function Harness({ sessionKey }: { sessionKey: string | null }): null {
    const [state, setState] = useState<Previews>({})
    previews = state
    setPreviews = setState
    useMobileNativeChatImagePreviewPersistence(sessionKey, state, setState)
    return null
  }

  async function mount(sessionKey: string | null): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { sessionKey }))
    })
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    await AsyncStorage.clear()
    resetNativeChatImagePreviewCacheForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('brings a session\'s previews back after a remount, dropping data: URIs', async () => {
    await mount('s1')
    act(() =>
      setPreviews({
        s1: { m1: ['file:///cache/a.jpg', 'data:image/png;base64,AAAA'], m2: ['file:///b.jpg'] }
      })
    )
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    act(() => renderer?.unmount())
    renderer = null
    // A relaunch: nothing in memory, so it comes back from storage.
    resetNativeChatImagePreviewCacheForTests()

    await mount('s1')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(previews).toEqual({ s1: { m1: ['file:///cache/a.jpg'], m2: ['file:///b.jpg'] } })
  })

  it('fills a chat that comes back in the same run from what it last wrote, with no storage read', async () => {
    await mount('s1')
    act(() => setPreviews({ s1: { m1: ['file:///cache/a.jpg'] } }))
    act(() => renderer?.unmount())
    renderer = null
    const read = vi.spyOn(AsyncStorage, 'getItem')
    await mount('s1')
    expect(previews).toEqual({ s1: { m1: ['file:///cache/a.jpg'] } })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it('lets a preview that landed before hydration win for its message', async () => {
    await mount('s1')
    act(() => setPreviews({ s1: { m1: ['file:///old.jpg'] } }))
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    act(() => renderer?.unmount())
    renderer = null

    await mount('s1')
    act(() => setPreviews({ s1: { m1: ['file:///new.jpg'] } }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(previews.s1?.m1).toEqual(['file:///new.jpg'])
  })

  // The previous run's copy draws the chat at once; the session's own entry
  // is the record, and must still be read in, however soon the state gains
  // an entry of its own (the copy, or a photo that just landed).
  it('completes the previous run’s copy with what storage holds for the session', async () => {
    await saveNativeChatImagePreviews('s1', { m1: ['file:///a.jpg'] })
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    await AsyncStorage.setItem(
      `orca:chatImagePreviews:${encodeURIComponent('s1')}`,
      JSON.stringify({ m1: ['file:///a.jpg'], m2: ['file:///b.jpg'] })
    )
    resetNativeChatImagePreviewCacheForTests()
    await hydrateNativeChatImagePreviewCache()
    await mount('s1')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(previews).toEqual({ s1: { m1: ['file:///a.jpg'], m2: ['file:///b.jpg'] } })
  })

  it('still reads in the older photos when a new one lands before the read does', async () => {
    let answer: (raw: string) => void = () => {}
    const read = vi
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(() => new Promise<string | null>((resolve) => (answer = resolve)))
    await mount('s1')
    // A photo lands the way the draft store merges one in.
    act(() => setPreviews((previous) => ({ ...previous, s1: { ...previous.s1, m3: ['file:///new.jpg'] } })))
    await act(async () => {
      answer(JSON.stringify({ m1: ['file:///old.jpg'] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(previews.s1).toEqual({ m1: ['file:///old.jpg'], m3: ['file:///new.jpg'] })
    read.mockRestore()
  })

  it('removes the stored entry once a session has no file previews left', async () => {
    await mount('s1')
    act(() => setPreviews({ s1: { m1: ['file:///a.jpg'] } }))
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    act(() => setPreviews({ s1: {} }))
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    expect(await AsyncStorage.getAllKeys()).toEqual([])
  })

  it('keeps a preview attached just before the screen closed', async () => {
    await mount('s1')
    act(() => setPreviews({ s1: { m1: ['file:///a.jpg'] } }))
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    expect(await AsyncStorage.getAllKeys()).toHaveLength(1)
  })
})
