import { describe, expect, it } from 'vitest'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import { mergeStoredSessionOptionRecord } from './session-option-records'

describe('mergeStoredSessionOptionRecord', () => {
  it('keeps the reported model but carries the user\'s effort pick over', () => {
    const live: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: {}
    }
    const stored: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'sonnet', source: 'dispatched' },
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    }
    expect(mergeStoredSessionOptionRecord(live, stored)).toBe(true)
    expect(live.model).toEqual({ value: 'opus', source: 'reported' })
    expect(live.valuesByModel.opus?.effort).toEqual({ value: 'high', source: 'dispatched' })
  })

  it('never overrides a newer in-memory pick, and ignores stored reported values', () => {
    const live: NativeChatSessionOptionRecord = {
      agent: 'claude',
      valuesByModel: { opus: { effort: { value: 'max', source: 'dispatched' } } }
    }
    const stored: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: {
        opus: { effort: { value: 'high', source: 'dispatched' }, fast: { value: true, source: 'reported' } }
      }
    }
    expect(mergeStoredSessionOptionRecord(live, stored)).toBe(true)
    expect(live.valuesByModel.opus?.effort?.value).toBe('max')
    expect(live.valuesByModel.opus?.fast).toBeUndefined()
    // No report yet in memory: the stored model fills the gap.
    expect(live.model).toEqual({ value: 'opus', source: 'reported' })
  })
})
