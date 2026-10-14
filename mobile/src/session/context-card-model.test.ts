import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClaudeContextReport, type ClaudeContextReport } from './claude-context-report'
import { buildContextCard, formatTokens } from './context-card-model'

// The Claude app's context card model (com.anthropic.claude 1.261009.20, `ja20.g` builds it from
// `get_context_usage`'s `y6a`; `ja20.p` and `ja20.q` turn it into the bar and the legend), fed here
// with what Claude Code 2.1.300 painted for `/context` (fixtures/claude-context-2.1.300/).
const read = (name: string): ClaudeContextReport => {
  const report = readClaudeContextReport(
    readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300', name), 'utf8').split('\n')
  )
  if (!report) {
    throw new Error(`${name} did not parse`)
  }
  return report
}
const WIDE = read('context-130-cols.txt')
const ALL = read('context-all-110-cols.txt')

function synthetic(overrides: Partial<ClaudeContextReport>): ClaudeContextReport {
  return {
    model: null,
    modelId: null,
    usedTokens: 0,
    windowTokens: 1_000_000,
    usedPercent: 0,
    categories: [],
    sections: [],
    ...overrides
  }
}

describe('token labels, as the app prints them (`q330.i(tokens, true)`)', () => {
  it.each([
    [0, '0'],
    [631, '631'],
    [999, '999'],
    [1000, '1k'],
    [5000, '5k'],
    [23_800, '23.8k'],
    [934_200, '934.2k'],
    [999_949, '999.9k'],
    [999_950, '1M'],
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
    [2_000_000_000, '2B']
  ])('writes %d as %s', (tokens, label) => {
    expect(formatTokens(tokens)).toBe(label)
  })
})

describe('the card for the wide /context screen', () => {
  const card = buildContextCard(WIDE)

  it('says what the figure beside the bar says, and the words under it', () => {
    expect(card.displayPercent).toBe(3)
    expect(card.caption).toBe('32.8k of 1M tokens · Haiku 5.5')
    expect(card.a11y).toBe('3% of context window used')
  })

  it('draws a segment for each category that is at least half a percent of the window, and no others', () => {
    // The table adds to 1,000,081 tokens (each figure rounded), which is the denominator, as in the app
    // (`jMax = max(window, sum)`). System prompt is 5,000 of that: 0.4999%, under the line.
    expect(card.segments.map((segment) => segment.slot)).toEqual([1, 8])
    expect(card.segments[0]!.fraction).toBeCloseTo(23_800 / 1_000_081, 9)
    expect(card.segments[1]!.fraction).toBeCloseTo(33_000 / 1_000_081, 9)
  })

  it('lists the used rows largest first, the rest of them in the "other" colour, then the buffer and the free space', () => {
    expect(card.legend.map((row) => [row.name, row.tokensLabel, row.percentLabel, row.slot])).toEqual([
      ['System tools', '23.8k', '2.4%', 1],
      ['System prompt', '5k', '0.5%', 2],
      ['Skills', '2.7k', '0.3%', 3],
      ['MCP server instructions', '717', '0.1%', 4],
      ['MCP tools', '631', '0.1%', 7],
      ['Memory files', '23', '0.0%', 7],
      ['Messages', '10', '0.0%', 7],
      ['Autocompact buffer', '33k', '3.3%', 8],
      ['Free space', '934.2k', '93.4%', 9]
    ])
  })

  it('draws the MCP summary the table gave, and the sections it has no rows for are not invented', () => {
    expect(card.sections).toEqual([
      { key: 'mcp', title: 'MCP tools', totalLabel: '631', summary: '147 tools · 631 tokens', rows: [] }
    ])
  })
})

describe('the sections of /context all', () => {
  const card = buildContextCard(ALL)

  it('lists the custom agents with their tokens and totals them', () => {
    const agents = card.sections.find((section) => section.key === 'agents')
    expect(agents).toEqual({
      key: 'agents',
      title: 'Custom agents',
      totalLabel: '27',
      summary: null,
      rows: [{ name: 'capture-reviewer', tokensLabel: '27' }]
    })
  })

  it('lists on-demand MCP tools by name with no figure, and no total it was not given', () => {
    const mcp = card.sections.find((section) => section.key === 'mcp')
    expect(mcp?.rows).toHaveLength(22)
    expect(mcp?.rows[0]).toEqual({ name: 'mcp__claude-in-chrome__browser_batch', tokensLabel: null })
    expect(mcp?.totalLabel).toBeNull()
  })

  it('leaves Skills out: the app\'s card names MCP tools, memory files and custom agents only', () => {
    expect(card.sections.map((section) => section.key)).toEqual(['mcp', 'agents'])
  })
})

describe('the bar at sizes the real screens do not reach', () => {
  it('draws nothing and one legend row for a table that is all free space', () => {
    const card = buildContextCard(
      synthetic({ categories: [{ name: 'Free space', tokens: 1_000_000, percent: 100, kind: 'free' }] })
    )
    expect(card.segments).toEqual([])
    expect(card.legend.map((row) => [row.name, row.slot])).toEqual([['Free space', 9]])
    expect(card.displayPercent).toBe(0)
  })

  it('draws the one used category in the first colour', () => {
    const card = buildContextCard(
      synthetic({
        usedTokens: 300_000,
        usedPercent: 30,
        categories: [
          { name: 'Messages', tokens: 300_000, percent: 30, kind: 'used' },
          { name: 'Free space', tokens: 700_000, percent: 70, kind: 'free' }
        ]
      })
    )
    expect(card.segments).toEqual([{ slot: 1, fraction: 0.3 }])
    expect(card.displayPercent).toBe(30)
  })

  it('folds from the sixth used row on, in the grey "other" colour, when there is no buffer', () => {
    const used = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, index) => ({
      name,
      tokens: 100_000 - index * 10_000,
      percent: null,
      kind: 'used' as const
    }))
    const card = buildContextCard(
      synthetic({
        usedTokens: 490_000,
        categories: [...used, { name: 'Free space', tokens: 510_000, percent: null, kind: 'free' }]
      })
    )
    // Seven used rows are more than six: five are named, the last two share one segment.
    expect(card.segments.map((segment) => segment.slot)).toEqual([1, 2, 3, 4, 5, 7])
    expect(card.segments[5]!.fraction).toBeCloseTo(0.09, 9)
    expect(card.legend.map((row) => row.slot)).toEqual([1, 2, 3, 4, 5, 7, 7, 9])
  })

  it('keeps six used rows whole when there is no buffer, the sixth in the sixth colour', () => {
    const used = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, index) => ({
      name,
      tokens: 100_000 - index * 10_000,
      percent: null,
      kind: 'used' as const
    }))
    const card = buildContextCard(synthetic({ usedTokens: 450_000, categories: used }))
    expect(card.legend.map((row) => row.slot)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('caps the display at 100% and takes the bar\'s denominator from the larger of window and table', () => {
    const card = buildContextCard(
      synthetic({
        usedTokens: 1_200_000,
        categories: [{ name: 'Messages', tokens: 1_200_000, percent: null, kind: 'used' }]
      })
    )
    expect(card.displayPercent).toBe(100)
    expect(card.segments).toEqual([{ slot: 1, fraction: 1 }])
  })

  it('prints a deferred row with a dash in place of its percent, in the buffer colour', () => {
    const card = buildContextCard(
      synthetic({
        usedTokens: 10_000,
        categories: [
          { name: 'Messages', tokens: 10_000, percent: 1, kind: 'used' },
          { name: 'Free space', tokens: 990_000, percent: 99, kind: 'free' },
          // Claude Code prints (N/A) for a deferred row, so the parser reads no percent for it.
          { name: 'MCP tools (deferred)', tokens: 241_600, percent: null, kind: 'deferred' }
        ]
      })
    )
    expect(card.legend.at(-1)).toEqual({ name: 'MCP tools (deferred)', tokensLabel: '241.6k', percentLabel: '—', slot: 8 })
    // Deferred rows are not part of the window, so they leave the bar alone.
    expect(card.segments).toEqual([{ slot: 1, fraction: 0.01 }])
  })

  it('works out a percent for a row Claude Code printed none for, as the app does (tokens over the window)', () => {
    const card = buildContextCard(
      synthetic({
        usedTokens: 250_000,
        categories: [
          { name: 'Messages', tokens: 250_000, percent: null, kind: 'used' },
          { name: 'Free space', tokens: 750_000, percent: null, kind: 'free' }
        ]
      })
    )
    expect(card.legend.map((row) => row.percentLabel)).toEqual(['25.0%', '75.0%'])
  })
})
