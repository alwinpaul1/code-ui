import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeNativeChatOutbox,
  hydrateNativeChatOutbox,
  resetNativeChatOutboxForTests,
  subscribeNativeChatOutbox,
  type NativeChatOutboxEntry
} from './native-chat-outbox'

// The full suite turned up four unhandled rejections on 2026-10-17
// (images-leave-composer-when-send-lands.test.ts): a listener that threw when the stored list was
// read rejected the read, and with it every outbox write chained behind it, against
// changeNativeChatOutbox's own promise never to reject. One failing listener cost the session
// its outbox: no send after it was kept across a restart.

function entry(id: string): NativeChatOutboxEntry {
  return {
    id,
    draftKey: 'tab-1',
    pendingKey: null,
    text: 'deploy it',
    normalizedText: 'deploy it',
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true,
    createdAt: 1,
    operationId: `op-${id}`,
    autoAttempts: 0
  }
}

describe('the chat outbox after one of its listeners fails', () => {
  beforeEach(async () => {
    resetNativeChatOutboxForTests()
    await AsyncStorage.removeItem('orca:chatOutbox')
  })

  it('still reads its stored list, and keeps saving every send after it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = subscribeNativeChatOutbox(() => {
      throw new Error('listener failed')
    })
    try {
      await expect(hydrateNativeChatOutbox()).resolves.toBeUndefined()
      expect(warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')).toContain('listener')
    } finally {
      stop()
      warn.mockRestore()
    }
    await expect(changeNativeChatOutbox(() => [entry('m1')])).resolves.toBe(true)
    await expect(changeNativeChatOutbox((current) => [...current, entry('m2')])).resolves.toBe(true)
  })
})
