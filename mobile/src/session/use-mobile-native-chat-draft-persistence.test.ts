import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

const draftStore = new Map<string, string>()
vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async (key: string) => draftStore.get(key) ?? null),
  writeNativeChatDraft: vi.fn(async (key: string, text: string) => {
    if (text) {
      draftStore.set(key, text)
    } else {
      draftStore.delete(key)
    }
  })
}))

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

describe('native chat draft persistence', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    draftStore.clear()
  })

  function Harness({ tabId }: { tabId: string }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId: `session-${tabId}`,
      messages: [],
      transcriptSettled: true
    })
    return null
  }

  async function mount(tabId: string): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { tabId }))
    })
  }

  it('brings a draft back after the route unmounted and remounted', async () => {
    vi.useFakeTimers()
    try {
      await mount('tab-a')
      act(() => state!.setComposerText('half typed'))
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
      expect([...draftStore.values()]).toEqual(['half typed'])
      act(() => renderer?.unmount())
      renderer = null
      await mount('tab-a')
      await act(async () => {
        await Promise.resolve()
      })
      expect(state!.composerText).toBe('half typed')
      // Clearing removes the stored draft too.
      act(() => state!.setComposerText(''))
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
      expect(draftStore.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })


  it('does not bring a sent message back when the screen closes right after sending', async () => {
    // 2026-09-13, reported from the phone: a message the user had already sent
    // reappeared in the composer later and went out again glued to the next one
    // ("…is it because phone is on same folder in code ui app did you fix this
    // issues too"). Clearing the box only schedules the erase 250 ms later, and
    // unmounting inside that window cancelled it, so the stored copy outlived
    // the send and was hydrated back on the next visit.
    vi.useFakeTimers()
    try {
      await mount('tab-a')
      act(() => state!.setComposerText('a message the user already sent'))
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
      expect([...draftStore.values()]).toEqual(['a message the user already sent'])
      // Sending empties the box; the screen closes before the debounce fires.
      act(() => state!.setComposerText(''))
      act(() => renderer?.unmount())
      renderer = null
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
      expect(draftStore.size).toBe(0)
      await mount('tab-a')
      await act(async () => {
        await Promise.resolve()
      })
      expect(state!.composerText).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last thing typed when the screen closes before the debounce', async () => {
    vi.useFakeTimers()
    try {
      await mount('tab-a')
      act(() => state!.setComposerText('half typed'))
      act(() => renderer?.unmount())
      renderer = null
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
      expect([...draftStore.values()]).toEqual(['half typed'])
    } finally {
      vi.useRealTimers()
    }
  })

})
