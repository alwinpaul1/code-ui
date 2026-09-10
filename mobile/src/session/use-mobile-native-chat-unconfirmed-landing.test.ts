import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

function userTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('a send whose acknowledgement was lost but which did arrive', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
  })

  function Harness({
    messages = [],
    onUnconfirmedSendLanded
  }: {
    messages?: NativeChatMessage[]
    onUnconfirmedSendLanded?: () => void
  }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'a',
      sessionId: 'session-a',
      messages,
      launchDraft: null,
      launchDraftCreatedAt: null,
      chatActive: true,
      transcriptLoading: false,
      transcriptSettled: true,
      ...(onUnconfirmedSendLanded ? { onUnconfirmedSendLanded } : {})
    })
    return null
  }

  it('retires a stale send failure once the held send is seen in the transcript', async () => {
    // Reported 2026-09-10 with a screenshot: the message was delivered and its
    // bubble was on screen, while a red "Message not sent" from an earlier
    // attempt still sat above the composer. An ack-lost send is never reported
    // as accepted, so the view had no reason to retire the notice; the
    // transcript echo is the evidence that it should be gone.
    const onUnconfirmedSendLanded = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, { onUnconfirmedSendLanded }))
    })

    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.holdUnconfirmedSend(origin, 'ping', vi.fn())
      }
    })
    expect(onUnconfirmedSendLanded).not.toHaveBeenCalled()

    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          onUnconfirmedSendLanded,
          messages: [userTextMessage('m1', 'ping')]
        })
      )
    )

    expect(onUnconfirmedSendLanded).toHaveBeenCalled()
  })

  it('leaves the notice alone while nothing has landed', async () => {
    const onUnconfirmedSendLanded = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, { onUnconfirmedSendLanded }))
    })

    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.holdUnconfirmedSend(origin, 'ping', vi.fn())
      }
    })

    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          onUnconfirmedSendLanded,
          messages: [userTextMessage('m1', 'something else entirely')]
        })
      )
    )

    expect(onUnconfirmedSendLanded).not.toHaveBeenCalled()
  })
})
