import { beforeEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  resetNativeChatTranscriptCacheForTests,
  sharedNativeChatTranscriptRetention as retention
} from './mobile-native-chat-transcript-cache'

const message = (id: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [],
  timestamp: 0,
  source: 'transcript'
})

describe('shared native chat transcript cache', () => {
  beforeEach(() => resetNativeChatTranscriptCacheForTests())

  it('shows the last settled transcript of a project while its read is unsettled', () => {
    const a = [message('a')]
    retention.capture('proj-a', a)
    retention.capture('proj-b', [message('b')])
    expect(retention.visible({ identity: 'proj-a', messages: [], settled: false })).toBe(a)
    expect(retention.retained('proj-a')).toBe(a)
    expect(retention.visible({ identity: 'proj-c', messages: [], settled: false })).toEqual([])
  })

  it('caps the cache at twelve projects, dropping the least recent', () => {
    for (let i = 0; i < 13; i += 1) {
      retention.capture(`proj-${i}`, [message(String(i))])
    }
    expect(retention.retained('proj-0')).toBeNull()
    expect(retention.retained('proj-12')).not.toBeNull()
  })
})
