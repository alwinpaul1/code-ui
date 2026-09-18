import { createElement } from 'react'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

// appendComposerMention: the file reader's "Ask about lines" write. It fires
// while a FILE tab is active, not the chat tab it is about to switch back to
// — so the write has to land on the TARGET tab's draft, not whatever's on
// screen right now. Split from the send/pending suite so both stay under the
// per-file line cap (same reason use-mobile-native-chat-drafts-launch-draft.
// test.ts and its siblings exist).
describe('useMobileNativeChatDrafts appendComposerMention', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    await clearNativeChatDraftStores()
  })

  function Harness({ tabId }: { tabId: string }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId: `session-${tabId}`,
      messages: [] as NativeChatMessage[],
      transcriptSettled: true
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

  it('writes into a tab that is not the active one — it appears once that tab becomes active', async () => {
    await mount('file-tab')
    act(() => state?.appendComposerMention('chat-tab', '@src/App.tsx#L10-L20'))
    expect(state?.composerText).toBe('') // still on file-tab
    await switchTo('chat-tab')
    expect(state?.composerText).toBe('@src/App.tsx#L10-L20 ')
  })

  it('separates from text already drafted on the target tab with one space', async () => {
    await mount('chat-tab')
    act(() => state?.setComposerText('take a look'))
    await switchTo('file-tab')
    act(() => state?.appendComposerMention('chat-tab', '@src/App.tsx#L10'))
    await switchTo('chat-tab')
    expect(state?.composerText).toBe('take a look @src/App.tsx#L10 ')
  })

  it('does nothing for a null tab id — there is no scope to key the write by', async () => {
    await mount('a')
    act(() => state?.appendComposerMention(null as unknown as string, '@x'))
    expect(state?.composerText).toBe('')
  })
})
