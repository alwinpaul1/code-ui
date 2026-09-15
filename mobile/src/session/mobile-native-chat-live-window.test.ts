import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { createNativeChatMerger } from '../../../src/shared/native-chat-merge'
import {
  applyMobileNativeChatStreamFrame,
  LIVE_WINDOW_CEILING
} from './mobile-native-chat-stream-frame'

function row(id: string, role: NativeChatMessage['role'], text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

/**
 * 2026-09-15, reported from the phone: "see my mobile, that user message isn't
 * there", and replies that plainly existed on the host were absent.
 *
 * Claude Code writes ONE JSONL record per content block, so a single reply plus
 * three Bash calls is seven records. The turn behind that report wrote 67
 * records in eight minutes. The live window was capped at 40 and re-trimmed
 * from the FRONT on every append, so the turn evicted its own earlier replies
 * while the user was reading them — and the user's own bubble, anchored on a
 * row that had just been evicted, was re-pinned to the top of what remained.
 * Nothing was lost on disk; the phone threw it away.
 */
describe('a long turn on the phone', () => {
  it('does not evict its own earlier replies while it is still running', () => {
    const merger = createNativeChatMerger()
    // The first frame is the settled window the host sends on subscribe.
    applyMobileNativeChatStreamFrame({
      merger,
      frame: { type: 'snapshot', messages: [row('m0', 'user', 'go')], hasMore: false },
      limit: 40,
      replaceSnapshot: true
    })
    // Then the turn streams in, one record per content block, as Claude writes.
    let applied
    for (let i = 1; i <= 67; i += 1) {
      applied = applyMobileNativeChatStreamFrame({
        merger,
        frame: { type: 'appended', messages: [row(`m${i}`, 'assistant', `block ${i}`)] },
        limit: 40,
        replaceSnapshot: false
      })
    }
    const ids = (applied?.kind === 'messages' ? applied.messages : []).map((m) => m.id)
    // The reply that opened the turn must still be there to read.
    expect(ids).toContain('m1')
    expect(ids).toContain('m0')
  })

  it('still bounds the window, so a long session cannot grow without limit', () => {
    const merger = createNativeChatMerger()
    let applied
    for (let i = 0; i < LIVE_WINDOW_CEILING + 50; i += 1) {
      applied = applyMobileNativeChatStreamFrame({
        merger,
        frame: { type: 'appended', messages: [row(`m${i}`, 'assistant', `block ${i}`)] },
        limit: 40,
        replaceSnapshot: false
      })
    }
    const count = applied?.kind === 'messages' ? applied.messages.length : 0
    expect(count).toBeLessThanOrEqual(LIVE_WINDOW_CEILING)
  })
})
