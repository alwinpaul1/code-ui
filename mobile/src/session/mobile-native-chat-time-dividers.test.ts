import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { chatTimeDividerLabels, formatChatDividerTime } from './mobile-native-chat-time-dividers'

const msg = (id: string, timestamp: number | null, role: 'user' | 'assistant' = 'assistant'): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: id }],
  timestamp,
  source: 'transcript'
})
// 2026-09-13 (Sunday) 00:10 local.
const NOW = new Date(2026, 8, 13, 0, 10).getTime()
const MIN = 60_000

describe('chat time dividers', () => {
  it('draws a rule before the message that came after a long pause, not before the first', () => {
    const t0 = new Date(2026, 8, 11, 20, 0).getTime()
    const labels = chatTimeDividerLabels(
      [msg('a', t0), msg('b', t0 + 3 * MIN), msg('c', t0 + 29 * MIN), msg('d', t0 + 30 * MIN)],
      NOW
    )
    expect([...labels.keys()]).toEqual(['c'])
  })

  it('names a weekday for a pause earlier this week and only the clock for today', () => {
    const friday = new Date(2026, 8, 11, 20, 29).getTime()
    expect(formatChatDividerTime(friday, NOW)).toBe('Friday 8:29 pm')
    expect(formatChatDividerTime(new Date(2026, 8, 13, 0, 5).getTime(), NOW)).toBe('12:05 am')
    expect(formatChatDividerTime(new Date(2026, 7, 2, 17, 12).getTime(), NOW)).toBe('2 Aug 5:12 pm')
    expect(formatChatDividerTime(new Date(2025, 11, 24, 9, 0).getTime(), NOW)).toBe('24 Dec 2025 9:00 am')
  })

  it('skips messages without a timestamp and keeps the clock where it was', () => {
    const t0 = new Date(2026, 8, 12, 9, 0).getTime()
    const labels = chatTimeDividerLabels([msg('a', t0), msg('b', null), msg('c', t0 + 25 * MIN)], NOW)
    expect([...labels.keys()]).toEqual(['c'])
  })
})
