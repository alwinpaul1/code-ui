import { describe, expect, it } from 'vitest'
import { formatAgentCount, formatTokenCount } from './mobile-background-task-labels'

describe('how a workflow card words its figures', () => {
  it('rounds tokens at the edges of each unit', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1K')
    expect(formatTokenCount(147_300)).toBe('147K')
    expect(formatTokenCount(999_499)).toBe('999K')
    // 999,500 would round to "1000K"; it is a million, said as one.
    expect(formatTokenCount(999_500)).toBe('1.0M')
    expect(formatTokenCount(4_853_603)).toBe('4.9M')
  })

  it('counts one agent in the singular, none and many in the plural', () => {
    expect(formatAgentCount(1)).toBe('1 agent')
    expect(formatAgentCount(0)).toBe('0 agents')
    expect(formatAgentCount(22, true)).toBe('22 agents running')
    expect(formatAgentCount(1, true)).toBe('1 agent running')
  })
})
