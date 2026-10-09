import { createElement } from 'react'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

// A send the host refuses hands its text back to the composer it came from
// (Orca #25149, ported 2026-10-09). Split from use-mobile-native-chat-drafts.test.ts
// to keep both under the 800-line test limit.
describe('useMobileNativeChatDrafts: a refused send returns its text', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    await clearNativeChatDraftStores()
  })

  function Harness({
    tabId,
    sessionId = `session-${tabId}`,
    messages = [],
    launchDraft = null,
    chatActive = true,
    transcriptLoading = false,
    transcriptSettled = !transcriptLoading,
    onUnconfirmedSendLanded
  }: {
    tabId: string
    sessionId?: string | null
    messages?: NativeChatMessage[]
    launchDraft?: string | null
    chatActive?: boolean
    transcriptLoading?: boolean
    transcriptSettled?: boolean
    onUnconfirmedSendLanded?: () => void
  }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId,
      messages,
      ...(onUnconfirmedSendLanded ? { onUnconfirmedSendLanded } : {}),
      launchDraft,
      chatActive,
      transcriptLoading,
      transcriptSettled
    })
    return null
  }

  async function mount(tabId: string): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { tabId }))
    })
  }

  async function switchTo(tabId: string): Promise<void> {
    await act(async () => renderer?.update(createElement(Harness, { tabId })))
  }

  it('restores the text on a definite rejection', async () => {
    await mount('a')
    act(() => state?.setComposerText('ping'))
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.clearDraftForSend(origin, 'ping')
        state?.restoreRejectedDraft(origin, 'ping')
      }
    })
    expect(state?.composerText).toBe('ping')
  })

  it('appends a rejected send after edits typed while it was in flight', async () => {
    await mount('a')
    act(() => state?.setComposerText('ping'))
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.clearDraftForSend(origin, 'ping')
      }
    })
    act(() => state?.setComposerText('newer edit'))
    act(() => {
      if (origin) {
        state?.restoreRejectedDraft(origin, 'ping')
      }
    })
    expect(state?.composerText).toBe('newer edit\n\nping')
  })

  it('returns a rejected send even after a newer edit was cleared', async () => {
    await mount('a')
    act(() => state?.setComposerText('ping'))
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.clearDraftForSend(origin, 'ping')
      }
    })
    act(() => state?.setComposerText('newer edit'))
    act(() => state?.setComposerText(''))
    act(() => {
      if (origin) {
        state?.restoreRejectedDraft(origin, 'ping')
      }
    })

    expect(state?.composerText).toBe('ping')
  })

  // Every restoring caller hands back the same text, so a second restore of one
  // failed send, or one onto a draft the user already retyped it into, must not
  // draw it twice. The dedupe lives in vendored src/shared/returned-draft-text.ts,
  // whose own test the mobile gate does not run (review, 2026-10-09).
  it('draws a failed message once when it is returned twice or was already retyped', async () => {
    await mount('a')
    act(() => state?.setComposerText('ping'))
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.clearDraftForSend(origin, 'ping')
        state?.restoreRejectedDraft(origin, 'ping')
        state?.restoreRejectedDraft(origin, 'ping')
      }
    })
    expect(state?.composerText).toBe('ping')

    act(() => state?.setComposerText('as I said\n\nping'))
    act(() => {
      if (origin) {
        state?.restoreRejectedDraft(origin, 'ping')
      }
    })
    expect(state?.composerText).toBe('as I said\n\nping')
  })

  it('restores a rejected send onto its originating tab only', async () => {
    await mount('a')
    act(() => state?.setComposerText('from a'))
    const originA = state?.captureSendOrigin('from a')
    act(() => {
      if (originA) {
        state?.clearDraftForSend(originA, 'from a')
      }
    })

    await switchTo('b')
    act(() => state?.setComposerText('from b'))
    act(() => {
      if (originA) {
        state?.restoreRejectedDraft(originA, 'from a')
      }
    })
    expect(state?.composerText).toBe('from b')

    await switchTo('a')
    expect(state?.composerText).toBe('from a')
  })
})
