import { describe, expect, it } from 'vitest'
import { agentSessionFailureWords } from '../../../src/shared/agent-session-failure-words'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { captureSendBoundary } from './mobile-native-chat-pending-echo'
import {
  countImageSourceTurnsAfter,
  findLandedUnconfirmedSends,
  normalizeReconcileText,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'
import { mobileStructuredTranscript } from './mobile-structured-transcript'

// Found by the review of the #23684 port (d16165b70). The phone anchors a send on the last row it
// holds (`captureSendBoundary`), and every reader of that send finds the anchor by id. When that
// row was a Codex retry attempt, the next attempt collapsed it away, so the anchor named a row the
// chat no longer had: a send whose answer was lost never landed ("Delivery unconfirmed" over a
// message in the chat), and a caption-less photo's echo retired before its own row arrived.
function retry(sequence: number, attempt: number, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `retry-${agentId ?? 'root'}-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: {
      kind: 'status',
      tone: 'warning',
      ...agentSessionFailureWords(
        {
          kind: 'providerRetrying',
          detail: { text: `Reconnecting... ${attempt}/5`, audience: 'person' },
          retry: { cause: 'stream disconnected before completion' }
        },
        { surface: 'row', agentName: 'Codex' }
      )
    }
  }
}

function message(
  sequence: number,
  role: 'user' | 'assistant',
  text: string,
  agentId?: string
): AgentJournalRenderItem {
  return {
    itemId: `msg-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] }
  }
}

function heldSend(text: string, baselineTailMessageId: string | null): UnconfirmedSend {
  return {
    draftKey: 'draft',
    pendingKey: null,
    text,
    normalizedText: normalizeReconcileText(text),
    baselineTailMessageId,
    deadline: null
  }
}

describe('a send made while a Codex retry row is the last row', () => {
  it('lands when its own row arrives after a later retry attempt', () => {
    const atSend = mobileStructuredTranscript([message(1, 'assistant', 'Working on it'), retry(2, 1)], [])
    const held = heldSend('hello', captureSendBoundary(atSend, normalizeReconcileText('hello')).baselineTailMessageId)
    const later = mobileStructuredTranscript(
      [message(1, 'assistant', 'Working on it'), retry(2, 1), retry(3, 2), message(4, 'user', 'hello')],
      []
    )
    expect(findLandedUnconfirmedSends(later, [held])).toEqual([held])
  })

  it("lands when a subagent's retry run was the last row and the run went on after the send", () => {
    const atSend = mobileStructuredTranscript([message(1, 'assistant', 'Delegating'), retry(2, 1, 'sub-1')], [])
    const held = heldSend('hello', captureSendBoundary(atSend, normalizeReconcileText('hello')).baselineTailMessageId)
    const later = mobileStructuredTranscript(
      [message(1, 'assistant', 'Delegating'), retry(2, 1, 'sub-1'), message(3, 'user', 'hello'), retry(4, 2, 'sub-1')],
      []
    )
    expect(findLandedUnconfirmedSends(later, [held])).toEqual([held])
  })

  it("does not count an earlier photo as a caption-less photo send's own row", () => {
    const photo = message(1, 'user', '[Image: source: /tmp/earlier.png]')
    const tail = captureSendBoundary(mobileStructuredTranscript([photo, retry(2, 1)], []), '').baselineTailMessageId
    const later = mobileStructuredTranscript([photo, retry(2, 1), retry(3, 2)], [])
    expect(countImageSourceTurnsAfter(later, tail)).toBe(0)
  })

  it("keeps the run's row in place, updated to the latest attempt", () => {
    const drawn = mobileStructuredTranscript(
      [retry(1, 1), message(2, 'assistant', 'Subagent says', 'sub-1'), retry(3, 2)],
      []
    )
    expect(drawn.map((row) => row.id)).toEqual(['retry-root-1', 'msg-2'])
    expect(drawn[0]?.blocks).toEqual(mobileStructuredTranscript([retry(3, 2)], [])[0]?.blocks)
  })
})
