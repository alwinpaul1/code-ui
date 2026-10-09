// Two session screens can show one tab: the agent-history panel pushes a second one over the
// first (router.push to /session/<worktree>). A send belongs to the screen it was tapped on
// while that screen is mounted; only once it has gone do its writes follow the scope to a
// screen showing it now (mobile-native-chat-live-drafts.ts). Review of the remount fix, 2026-10-09.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>

describe("a send's undo goes to the screen that sent it while that screen is mounted", () => {
  const renderers: ReactTestRenderer[] = []

  afterEach(async () => {
    for (const renderer of renderers.splice(0)) {
      act(() => renderer.unmount())
    }
    resetLiveNativeChatDraftsForTests()
    await clearNativeChatDraftStores()
  })

  /** A session screen's draft store on `tab`; `seen.current` is its latest render. */
  function screen(tab: string) {
    const seen: { current: Drafts | null } = { current: null }
    function Screen({ tabId }: { tabId: string }): null {
      seen.current = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId,
        sessionId: `session-${tabId}`,
        messages: [],
        transcriptSettled: true
      })
      return null
    }
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Screen, { tabId: tab }))
    })
    renderers.push(renderer!)
    return {
      seen,
      switchTo(tabId: string): void {
        act(() => renderer!.update(createElement(Screen, { tabId })))
      },
      unmount(): void {
        act(() => renderer!.unmount())
        renderers.splice(renderers.indexOf(renderer!), 1)
      }
    }
  }

  it('puts the words back and retracts the bubble on the sending screen when a second screen for its tab came and went', () => {
    const a = screen('tab-a')
    act(() => a.seen.current!.setComposerText('hello'))
    let undo: (() => void) | null = null
    act(() => {
      undo = a.seen.current!.clearDraftAtSendStart('hello', ['file:///phone/p0.jpg'])
    })
    expect(a.seen.current!.pending).toHaveLength(1)
    const b = screen('tab-a')

    act(() => undo!())
    b.unmount()

    expect(a.seen.current!.pending).toEqual([])
    expect(a.seen.current!.composerText).toBe('hello')
  })

  it('puts the words back on the sending screen when it has moved to another tab and back, over a hidden screen of the same tab', () => {
    screen('tab-a')
    const top = screen('tab-a')
    act(() => top.seen.current!.setComposerText('hello'))
    let undo: (() => void) | null = null
    act(() => {
      undo = top.seen.current!.clearDraftAtSendStart('hello', ['file:///phone/p0.jpg'])
    })
    top.switchTo('tab-b')

    act(() => undo!())
    top.switchTo('tab-a')

    expect(top.seen.current!.composerText).toBe('hello')
    expect(top.seen.current!.pending).toEqual([])
  })
})
