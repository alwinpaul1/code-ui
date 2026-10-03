// The report (2026-10-03): after a photo send that did not submit, the phone composer showed
// the same text again while the sent bubble stayed. A rejected photo send puts the text back
// with `restoreRejectedDraft` and retracts the bubble with `removePending` in one undo
// (mobile-native-chat-draft-send-start.ts). These pin that the undo leaves no bubble
// behind, however late it comes, and survives a remount (the persisted echo, the waiting
// photo sends and the stored previews are the other places a bubble could live on).

import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>
type Renderer = { unmount(): void }

describe('retracting a photo send that did not go', () => {
  let renderer: Renderer | null = null
  let state: DraftState | null = null

  function Harness(): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host', worktreeId: 'wt', tabId: 'tab', sessionId: 'session',
      messages: [], transcriptLoading: false, transcriptSettled: true
    })
    return null
  }
  const mount = async (): Promise<void> => {
    await act(async () => { renderer = create(createElement(Harness)) })
  }
  const wait = (ms: number): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    await clearNativeChatDraftStores()
  })

  async function sendThenUndo(afterSendMs: number) {
    await mount()
    act(() => state!.setComposerText('what is wrong here'))
    let undo: (() => void) | null = null
    act(() => { undo = state!.clearDraftAtSendStart('what is wrong here', ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'], ['/a', '/b', '/c']) })
    expect(state!.composerText).toBe('')
    expect(state!.pending).toHaveLength(1)
    await wait(afterSendMs)
    act(() => undo!())
  }

  it('restores the text and leaves no bubble when the undo comes at once', async () => {
    await sendThenUndo(0)
    expect(state!.composerText).toBe('what is wrong here')
    expect(state!.pending).toEqual([])
    expect(state!.waitingPhotoSends ?? []).toEqual([])
  })

  it('restores the text and leaves no bubble when the undo comes after the echo was stored', async () => {
    await sendThenUndo(600)
    await wait(600)
    expect(state!.composerText).toBe('what is wrong here')
    expect(state!.pending).toEqual([])
    expect(state!.waitingPhotoSends ?? []).toEqual([])
  })

  it('draws no bubble when the chat is reopened after the undo', async () => {
    await sendThenUndo(600)
    await wait(600)
    act(() => renderer!.unmount())
    await mount()
    await wait(300)
    expect(state!.pending).toEqual([])
    expect(state!.waitingPhotoSends ?? []).toEqual([])
    expect(Object.keys(state!.imagePreviewsByMessageId ?? {})).toEqual([])
  })
})
