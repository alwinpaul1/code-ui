import { createElement, useState, type Dispatch, type SetStateAction } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatImagePreviewPersistence } from './use-mobile-native-chat-image-preview-persistence'

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

    await mount('s1')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(previews).toEqual({ s1: { m1: ['file:///cache/a.jpg'], m2: ['file:///b.jpg'] } })
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
})
