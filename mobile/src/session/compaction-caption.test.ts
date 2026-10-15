import { describe, expect, it } from 'vitest'
import { compactionCaption, compactionTokenCount, readCompactionTokens } from './compaction-caption'

// The Claude app 1.261009.20: the caption is `t330.h` (t330.java:477-500) over `alt.b`
// (alt.java:18-23), its number is `q330.i(n, false)` (q330.java:1761-1779) rounded by `q330.r`
// (q330.java:2074) to one decimal, half up; its words are the plurals
// `ccr_context_compacted_saved_tokens` / `_from_tokens` (res-out plurals.xml:91-98).
describe('the compaction divider caption', () => {
  it('says what the compaction saved, as the Claude app does for a real boundary', () => {
    // Real boundary from this machine's transcript of Claude Code (preTokens 167968,
    // postTokens 14060), so 153,908 were saved.
    expect(compactionCaption({ preTokens: 167968, postTokens: 14060 })).toBe('Compacted conversation · saved 153.9k tokens')
  })

  it('writes the screenshot caption: 946.8k saved', () => {
    expect(compactionCaption({ preTokens: 1_000_000, postTokens: 53_200 })).toBe('Compacted conversation · saved 946.8k tokens')
  })

  it('writes a count under 1,000 as the plain number', () => {
    expect(compactionTokenCount(0)).toBe('0')
    expect(compactionTokenCount(1)).toBe('1')
    expect(compactionTokenCount(999)).toBe('999')
    expect(compactionCaption({ preTokens: 1500, postTokens: 1000 })).toBe('Compacted conversation · saved 500 tokens')
  })

  it('says "1 token" for one, as the plural resource does', () => {
    expect(compactionCaption({ preTokens: 11, postTokens: 10 })).toBe('Compacted conversation · saved 1 token')
  })

  it('keeps one decimal always, k and M, with no trailing-zero trimming', () => {
    expect(compactionTokenCount(1000)).toBe('1.0k')
    expect(compactionTokenCount(1250)).toBe('1.3k')
    expect(compactionTokenCount(1249)).toBe('1.2k')
    expect(compactionTokenCount(160_000)).toBe('160.0k')
  })

  it('rolls 999,950 and over up to M, never "1000.0k"', () => {
    expect(compactionTokenCount(999_949)).toBe('999.9k')
    expect(compactionTokenCount(999_950)).toBe('1.0M')
    expect(compactionTokenCount(1_000_000)).toBe('1.0M')
    expect(compactionTokenCount(1_234_567)).toBe('1.2M')
  })

  it('rolls up to B from 999.95M and over', () => {
    expect(compactionTokenCount(999_950_000)).toBe('1.0B')
    expect(compactionTokenCount(1_500_000_000)).toBe('1.5B')
  })

  it('draws no count when the event states none', () => {
    expect(compactionCaption({})).toBe('Compacted conversation')
    expect(compactionCaption({ preTokens: null, postTokens: null })).toBe('Compacted conversation')
  })

  it('draws no count for a pre figure with no post figure, as the app does', () => {
    // k23.java:1245-1255: pre without post drops the pair, so the divider is plain.
    expect(compactionCaption({ preTokens: 160_000 })).toBe('Compacted conversation')
  })

  it('draws no count for a post figure with no pre figure', () => {
    expect(compactionCaption({ postTokens: 14_060 })).toBe('Compacted conversation')
  })

  it('says "from N tokens" when nothing was saved but the size is known', () => {
    // alt.java:19-20: pre at or under post with pre over zero is `x89`, "from".
    expect(compactionCaption({ preTokens: 5000, postTokens: 5000 })).toBe('Compacted conversation · from 5.0k tokens')
    expect(compactionCaption({ preTokens: 1, postTokens: 9 })).toBe('Compacted conversation · from 1 token')
  })

  it('draws no count when pre is zero and nothing was saved', () => {
    expect(compactionCaption({ preTokens: 0, postTokens: 0 })).toBe('Compacted conversation')
  })

  it('reads counts from the stream form and the transcript form, and refuses what is not a count', () => {
    expect(readCompactionTokens({ pre_tokens: 167968, post_tokens: 14060 })).toEqual({ preTokens: 167968, postTokens: 14060 })
    expect(readCompactionTokens({ preTokens: 167968, postTokens: 14060 })).toEqual({ preTokens: 167968, postTokens: 14060 })
    expect(readCompactionTokens(undefined)).toEqual({})
    expect(readCompactionTokens('x')).toEqual({})
    expect(readCompactionTokens({ pre_tokens: '167968', post_tokens: 1.5 })).toEqual({})
    // k23.java:26-29: outside 0..2147483647 the app logs and drops the figure.
    expect(readCompactionTokens({ pre_tokens: -1, post_tokens: 2147483648 })).toEqual({})
    expect(readCompactionTokens({ pre_tokens: 2147483647, post_tokens: 0 })).toEqual({ preTokens: 2147483647, postTokens: 0 })
  })
})
