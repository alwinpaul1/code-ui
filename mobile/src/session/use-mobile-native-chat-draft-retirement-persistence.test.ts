import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { readNativeChatPendingEchoes } from '../storage/native-chat-pending-echoes'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

function userTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('saved chat message retirement', () => {
  let renderer: ReactTestRenderer
  let state: ReturnType<typeof useMobileNativeChatDrafts>
  const emptyMessages: NativeChatMessage[] = []
  function Harness({
    tabId,
    messages = emptyMessages
  }: {
    tabId: string
    messages?: NativeChatMessage[]
  }) {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId: `session-${tabId}`,
      messages,
      transcriptSettled: true
    })
    return null
  }
  async function mount(tabId: string) {
    await act(async () => {
      renderer = create(createElement(Harness, { tabId }))
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
  })
  it('gives restored and newly sent bubbles distinct list keys after reopening', async () => {
    vi.useFakeTimers()
    try {
      await mount('unique-pending')
      act(() => state!.acceptSend(state!.captureSendOrigin('first')!, 'first'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      act(() => renderer!.unmount())
      await mount('unique-pending')
      act(() => state!.acceptSend(state!.captureSendOrigin('second')!, 'second'))
      expect(state!.pending.map((item) => item.text)).toEqual(['first', 'second'])
      expect(new Set(state!.pending.map((item) => item.id)).size).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the saved echo when its transcript lands so reopening cannot replay it', async () => {
    vi.useFakeTimers()
    try {
      await mount('persist-retired')
      const origin = state!.captureSendOrigin('already delivered')!
      act(() => state!.acceptSend(origin, 'already delivered'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      expect(await readNativeChatPendingEchoes(origin.pendingKey!)).toHaveLength(1)
      await act(async () =>
        renderer!.update(
          createElement(Harness, {
            tabId: 'persist-retired',
            messages: [userTextMessage('landed', 'already delivered')]
          })
        )
      )
      expect(state!.pending).toEqual([])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      expect(await readNativeChatPendingEchoes(origin.pendingKey!)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
