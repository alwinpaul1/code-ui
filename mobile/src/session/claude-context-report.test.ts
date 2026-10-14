import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTokenCount, readClaudeContextReport } from './claude-context-report'

// Real screens: Claude Code 2.1.300 (Haiku 5.5, a 1M window), `/context` and `/context all` painted
// in a tmux pane of the stated width and read back with `tmux capture-pane -p` (2026-10-14). Only the
// working-directory path on the banner row is replaced. The two Claude Code builds the Code UI
// beacon was verified against (2.1.296, 2.1.300) share this layout; the captures name the one they
// came from. Codex's `/status` (codex-cli 0.153.4) is the other agent: it paints no category table.
const read = (name: string): string[] =>
  readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300', name), 'utf8').split('\n')

const WIDE = read('context-130-cols.txt')
const WRAPPED_80 = read('context-80-cols-wrapped.txt')
const WRAPPED_48 = read('context-48-cols-wrapped.txt')
const ALL = read('context-all-110-cols.txt')
const MEMORY = read('context-110-cols-memory-files.txt')
const CODEX_STATUS = read('codex-status-0.153.4.txt')

const namesAndTokens = (lines: string[]): [string, number][] =>
  (readClaudeContextReport(lines)?.categories ?? []).map((category) => [category.name, category.tokens])

describe('the /context table, read off the screen', () => {
  it('reads the model, the totals and every category row of the wide screen', () => {
    const report = readClaudeContextReport(WIDE)
    expect(report).toMatchObject({
      model: 'Haiku 5.5',
      modelId: 'claude-haiku-5-5',
      usedTokens: 32_800,
      windowTokens: 1_000_000,
      usedPercent: 3
    })
    expect(namesAndTokens(WIDE)).toEqual([
      ['System prompt', 5000],
      ['System tools', 23_800],
      ['MCP tools', 631],
      ['MCP server instructions', 717],
      ['Memory files', 23],
      ['Skills', 2700],
      ['Messages', 10],
      ['Free space', 934_200],
      ['Autocompact buffer', 33_000]
    ])
  })

  it('sorts each row by what it is: free space, the autocompact buffer, and the rest as used', () => {
    const kinds = readClaudeContextReport(WIDE)?.categories.map((category) => [category.name, category.kind])
    expect(kinds).toEqual([
      ['System prompt', 'used'],
      ['System tools', 'used'],
      ['MCP tools', 'used'],
      ['MCP server instructions', 'used'],
      ['Memory files', 'used'],
      ['Skills', 'used'],
      ['Messages', 'used'],
      ['Free space', 'free'],
      ['Autocompact buffer', 'buffer']
    ])
  })

  it('keeps the percent Claude Code printed beside each row, including the 0.0% ones', () => {
    const percents = readClaudeContextReport(WIDE)?.categories.map((category) => category.percent)
    expect(percents).toEqual([0.5, 2.4, 0.1, 0.1, 0, 0.3, 0, 93.4, 3.3])
  })

  it('reads the memory files figure of a session that has some (973 tokens)', () => {
    expect(namesAndTokens(MEMORY)).toContainEqual(['Memory files', 973])
    expect(readClaudeContextReport(MEMORY)?.usedTokens).toBe(32_500)
  })

  it('reads the summary line of each section under the table', () => {
    expect(readClaudeContextReport(WIDE)?.sections).toEqual([
      { title: 'MCP tools', hint: '/mcp (loaded on-demand)', summary: '147 tools · 631 tokens', rows: [] },
      { title: 'Skills', hint: '/skills', summary: '18 skills · 2.7k tokens', rows: [] }
    ])
  })
})

describe('the same table at the widths where Claude Code wraps its rows', () => {
  it('joins a row whose percent wrapped to the next line, at 80 columns', () => {
    // "⛁ System tools: 23.8k tokens" / "(2.4%)", and "MCP server instructions: 717" / "tokens (0.1%)".
    expect(namesAndTokens(WRAPPED_80)).toEqual([
      ['System prompt', 5000],
      ['System tools', 23_800],
      ['MCP tools', 631],
      ['MCP server instructions', 717],
      ['Custom agents', 27],
      ['Memory files', 23],
      ['Skills', 2700],
      ['Messages', 10],
      ['Free space', 934_100],
      ['Autocompact buffer', 33_000]
    ])
    expect(readClaudeContextReport(WRAPPED_80)?.categories[1]?.percent).toBe(2.4)
    expect(readClaudeContextReport(WRAPPED_80)?.categories[3]?.percent).toBe(0.1)
  })

  it('joins them at 48 columns too, where nearly every row wraps', () => {
    const report = readClaudeContextReport(WRAPPED_48)
    expect(report?.usedTokens).toBe(32_500)
    expect(report?.categories.map((category) => [category.name, category.tokens, category.percent])).toEqual([
      ['System prompt', 5000, 0.5],
      ['System tools', 23_800, 2.4],
      ['Custom agents', 27, 0],
      ['Memory files', 973, 0.1],
      ['Skills', 2700, 0.3],
      ['Messages', 10, 0],
      ['Free space', 934_500, 93.5],
      ['Autocompact buffer', 33_000, 3.3]
    ])
  })

  it('reads the Custom agents section of the 80-column screen between MCP tools and Skills', () => {
    expect(readClaudeContextReport(WRAPPED_80)?.sections.map((section) => [section.title, section.summary])).toEqual([
      ['MCP tools', '147 tools · 631 tokens'],
      ['Custom agents', '1 agent · 27 tokens'],
      ['Skills', '18 skills · 2.7k tokens']
    ])
  })
})

describe('/context all, which lists what is under each section', () => {
  it('reads the rows of each section with the tokens Claude Code gave them', () => {
    const sections = readClaudeContextReport(ALL)?.sections ?? []
    expect(sections.map((section) => [section.title, section.rows.length])).toEqual([
      ['MCP tools', 22],
      ['Custom agents', 1],
      ['Skills', 18]
    ])
    expect(sections[1]).toEqual({
      title: 'Custom agents',
      hint: '.claude/agents/',
      summary: null,
      rows: [{ name: 'capture-reviewer', tokens: 27, approximate: false }]
    })
    // Skills carry an estimate ("~480 tokens"), which is drawn as one.
    expect(sections[2]?.rows[0]).toEqual({ name: 'dataviz', tokens: 480, approximate: true })
    // An on-demand tool has a name and no figure.
    expect(sections[0]?.rows[0]).toEqual({ name: 'mcp__claude-in-chrome__browser_batch', tokens: null, approximate: false })
  })

  it('reads the same category table above the lists', () => {
    expect(readClaudeContextReport(ALL)?.usedTokens).toBe(31_500)
    expect(namesAndTokens(ALL).map(([name]) => name)).toEqual([
      'System prompt',
      'System tools',
      'Custom agents',
      'Memory files',
      'Skills',
      'Messages',
      'Free space',
      'Autocompact buffer'
    ])
  })
})

describe('refusing what is not a whole table', () => {
  it('reads nothing from a screen that has scrolled past the "Context Usage" heading', () => {
    // The same real screen with its first twelve rows gone: the legend is still there, the heading
    // and the totals are not, and a bar built from half a table would be wrong.
    expect(readClaudeContextReport(ALL.slice(12))).toBeNull()
  })

  it('reads nothing from a table cut short before its free-space row', () => {
    const cut = WIDE.filter((line) => !line.includes('Free space'))
    expect(readClaudeContextReport(cut)).toBeNull()
  })

  it('reads nothing when a row has lost its figure and the rest no longer add up to the window', () => {
    // 2.7k of Skills dropped: the used rows, the buffer and the free space then sum to 2.7k less
    // than the 1M window, which a whole table never does.
    const dropped = WIDE.filter((line) => !line.includes('Skills: 2.7k'))
    expect(readClaudeContextReport(dropped)).toBeNull()
  })

  it('reads nothing from Codex, which prints no category table (codex-cli 0.153.4 /status)', () => {
    expect(readClaudeContextReport(CODEX_STATUS)).toBeNull()
  })

  it('reads nothing from an empty screen and from one with only a heading', () => {
    expect(readClaudeContextReport([])).toBeNull()
    expect(readClaudeContextReport(['  ⎿  Context Usage'])).toBeNull()
  })

  it('reads the one-row table: a heading, its totals and a free-space row alone', () => {
    const report = readClaudeContextReport([
      '❯ /context',
      '  ⎿  Context Usage',
      '     ⛶ ⛶ ⛶ ⛶ ⛶   claude-haiku-5-5',
      '     ⛶ ⛶ ⛶ ⛶ ⛶   0/200k tokens (0%)',
      '     ⛶ ⛶ ⛶ ⛶ ⛶   Estimated usage by category',
      '     ⛶ ⛶ ⛶ ⛶ ⛶   ⛶ Free space: 200k (100.0%)'
    ])
    expect(report?.categories).toEqual([{ name: 'Free space', tokens: 200_000, percent: 100, kind: 'free' }])
    expect(report?.windowTokens).toBe(200_000)
  })

  it('takes the latest table when two are on screen', () => {
    const twice = [...WRAPPED_48.slice(0, 40), ...WIDE.slice(0, 40)]
    expect(readClaudeContextReport(twice)?.usedTokens).toBe(32_800)
  })
})

// Found by the review of this batch, each against a real Claude Code 2.1.300 screen or the renderer's
// own code (the binary's `FYr` names the three kinds of row, and its legend builder prints a deferred
// row with a space for its glyph and "N/A" for its percent).
describe('rows Claude Code prints in other sessions than the first captures', () => {
  const AUTO_COMPACT_OFF = read('context-130-cols-auto-compact-off.txt')

  it('reads the buffer of a session with auto-compact off, which Claude Code calls "Compact buffer"', () => {
    // `DISABLE_AUTO_COMPACT=1`: the autocompact row is named without "Auto" and sits before Free space.
    const report = readClaudeContextReport(AUTO_COMPACT_OFF)
    expect(report?.categories.find((category) => category.name === 'Compact buffer')).toEqual({
      name: 'Compact buffer',
      tokens: 3000,
      percent: 0.3,
      kind: 'buffer'
    })
    expect(report?.categories.filter((category) => category.kind === 'used').map((category) => category.name)).toEqual([
      'System prompt',
      'System tools',
      'Custom agents',
      'Memory files',
      'Skills',
      'Messages'
    ])
  })

  it('reads a deferred row as Claude Code builds it: a space for its glyph and (N/A) for its percent', () => {
    const withDeferred = WIDE.flatMap((line) =>
      line.includes('⛁ Memory files: 23 tokens')
        ? [line, `${line.slice(0, line.indexOf('⛁ Memory files'))}  MCP tools (deferred): 241.6k tokens (N/A)`]
        : [line]
    )
    const report = readClaudeContextReport(withDeferred)
    expect(report?.categories.find((category) => category.name === 'MCP tools (deferred)')).toEqual({
      name: 'MCP tools (deferred)',
      tokens: 241_600,
      percent: null,
      kind: 'deferred'
    })
  })

  it('reads a deferred row whose (N/A) wrapped to the next line, as at 80 columns', () => {
    const wrapped = WRAPPED_80.flatMap((line) =>
      line.includes('⛁ Memory files: 23 tokens')
        ? [line, `${line.slice(0, line.indexOf('⛁ Memory files'))}  MCP tools (deferred): 241.6k tokens`, '     (N/A)']
        : [line]
    )
    expect(
      readClaudeContextReport(wrapped)?.categories.find((category) => category.name === 'MCP tools (deferred)')?.kind
    ).toBe('deferred')
  })
})

describe('a table that is not this session\'s /context', () => {
  it('is not read from a copy of one a tool printed (a real `! sed` over a saved table, 2.1.300)', () => {
    // The heading is "⎿  ⎿  Context Usage": the tool result's own marker, then the copy's. The
    // conversation had never run /context; Claude Code's reply to the copy says what it is.
    expect(readClaudeContextReport(read('context-quoted-by-a-tool-130-cols.txt'))).toBeNull()
  })

  it('is not read without the command that printed it on the row above its heading', () => {
    // The real table with its "❯ /context" echo row gone: a heading alone does not say who painted it.
    expect(readClaudeContextReport(WIDE.filter((line) => !line.startsWith('❯ /context')))).toBeNull()
  })

  it('is read for `/context all` and for the command typed in a pane Claude Code wrapped', () => {
    expect(readClaudeContextReport(ALL)).not.toBeNull()
    expect(readClaudeContextReport(WRAPPED_48)).not.toBeNull()
  })

  it('is not read from a reply that quotes the table in a code block', () => {
    const reply = [
      '❯ what is in my context',
      '⏺ It looks like this:',
      '  ```',
      ...WIDE.slice(7, 24).map((line) => `  ${line}`),
      '  ```'
    ]
    expect(readClaudeContextReport(reply)).toBeNull()
  })
})

describe('a legend row the parser cannot read', () => {
  it('refuses the whole table rather than drawing it without that row', () => {
    // The row's count wrapped away from its name, so it reads as nothing, and 10 tokens are small
    // enough to leave the sum inside its tolerance. A bar built from the rows that did read is not
    // this session's.
    const split = WRAPPED_80.flatMap((line) =>
      line.includes('⛁ Messages: 10 tokens')
        ? [line.replace(' 10 tokens (0.0%)', ''), '     10 tokens (0.0%)']
        : [line]
    )
    expect(split.some((line) => line.endsWith('⛁ Messages:'))).toBe(true)
    expect(readClaudeContextReport(split)).toBeNull()
  })
})

describe('token counts as Claude Code prints them', () => {
  it.each([
    ['631', 631],
    ['5k', 5000],
    ['23.8k', 23_800],
    ['934.2k', 934_200],
    ['1m', 1_000_000],
    ['1.5M', 1_500_000],
    ['~480', 480],
    ['0', 0]
  ])('reads %s as %d', (text, tokens) => {
    expect(parseTokenCount(text)).toBe(tokens)
  })

  it('refuses text that is not a count', () => {
    expect(parseTokenCount('')).toBeNull()
    expect(parseTokenCount('tokens')).toBeNull()
    expect(parseTokenCount('1.2.3k')).toBeNull()
  })
})
