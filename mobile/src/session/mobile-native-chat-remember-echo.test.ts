import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { echoMemoryId, rememberEchoInPending } from './mobile-native-chat-remember-echo'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

// 2026-09-13: a message sent from the Claude app mid-turn showed on the phone
// right after an install and was gone an hour later, because it lived only in
// a witness hook's memory. Remembered with the phone's own sends it survives.
describe('rememberEchoInPending', () => {
  it('stores a witnessed message once, anchored, expecting one more landing than the transcript has', () => {
    const id = echoMemoryId('see these messages')
    const once = rememberEchoInPending({}, 'k', id, 'see these messages', 'a5', [user('u1', 'see these messages')], 'd')
    expect(once.k).toMatchObject([
      { id, text: 'see these messages', baselineTailMessageId: 'a5', expectedOccurrence: 2, baselineResolved: true }
    ])
    // Found again on the next reading, or after a relaunch: not stored twice.
    expect(rememberEchoInPending(once, 'k', id, 'see these messages', 'a5', [], 'd')).toBe(once)
  })

  it('gives the same text the same id however it was wrapped or marked', () => {
    expect(echoMemoryId('[Image #1] see  these\nmessages')).toBe(echoMemoryId('see these messages'))
    expect(echoMemoryId('see these messages')).not.toBe(echoMemoryId('see those messages'))
  })
})
