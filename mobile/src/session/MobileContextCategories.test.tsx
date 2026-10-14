import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkContextCategoryPalette, lightContextCategoryPalette } from '../theme/context-category-palette'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's context card (com.anthropic.claude 1.261009.20, `s5a` and `l800`): a header row, the
// segmented bar (8 dp tall, a capsule, no gaps, on the 15% grey track `ad5.F()`), the caption "N of M
// tokens · model", and, expanded, the legend, then MCP tools, memory files and custom agents (more than
// 12 rows show 12 and a "Show N more", at most 50 a tap), ending in "Show less". Fed here with the
// tables Claude Code 2.1.300 painted for `/context` and `/context all`
// (fixtures/claude-context-2.1.300/).
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: (props: Record<string, unknown>) => createElement('ChevronDown', props),
  ChevronUp: (props: Record<string, unknown>) => createElement('ChevronUp', props)
}))

import { ThemeProvider } from '../theme/theme-context'
import { readClaudeContextReport } from './claude-context-report'
import { ContextCategoriesView, formatReportAge } from './MobileContextCategories'

const table = (name: string) => {
  const report = readClaudeContextReport(
    readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300', name), 'utf8').split('\n')
  )
  if (!report) {
    throw new Error(`${name} did not parse`)
  }
  return report
}
const WIDE = table('context-130-cols.txt')
const ALL = table('context-all-110-cols.txt')
const SEEN = new Date(2026, 9, 14, 21, 30).getTime()
const NOW = new Date(2026, 9, 14, 21, 39).getTime()

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

type Scheme = 'light' | 'dark'
const colorsOf = (scheme: Scheme) => (scheme === 'light' ? lightColors : darkColors)
const paletteOf = (scheme: Scheme) => (scheme === 'light' ? lightContextCategoryPalette : darkContextCategoryPalette)
function flat(style: unknown): Record<string, unknown> {
  const list = [typeof style === 'function' ? style({ pressed: false }) : style].flat(Infinity)
  return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'))
}
const host = (id: string): ReactTestInstance =>
  renderer!.root.find((node) => node.props.testID === id && typeof node.type === 'string')
const hosts = (prefix: string): ReactTestInstance[] =>
  renderer!.root.findAll((node) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith(prefix))
const hasHost = (id: string): boolean => hosts(id).some((node) => node.props.testID === id)
const words = (root: ReactTestInstance = renderer!.root): string[] =>
  root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
const press = (id: string) => act(() => host(id).props.onPress())

describe('how old a table is', () => {
  const at = (minutes: number) => SEEN + minutes * 60_000
  it.each([
    [0, 'just now'],
    [0.9, 'just now'],
    [1, '1 min ago'],
    [9, '9 min ago'],
    [59, '59 min ago'],
    [60, '1 h ago'],
    [180, '3 h ago'],
    [24 * 60, '1 d ago'],
    [50 * 60, '2 d ago']
  ])('says %d minutes as %s', (minutes, label) => {
    expect(formatReportAge(SEEN, at(minutes))).toBe(label)
  })

  it('says nothing for a table whose age the phone does not know, and nothing for a clock that ran back', () => {
    expect(formatReportAge(null, NOW)).toBeNull()
    expect(formatReportAge(SEEN, SEEN - 60_000)).toBe('just now')
  })
})

describe.each(['light', 'dark'] as const)('the category card in %s mode', (scheme) => {
  const colors = colorsOf(scheme)
  const palette = paletteOf(scheme)
  const show = (breakdown: { report: typeof WIDE; readAt: number | null }) =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ContextCategoriesView breakdown={breakdown} now={NOW} />
        </ThemeProvider>
      )
    })

  it('draws the bar 8 dp tall as a capsule on the app\'s track, a segment for each category worth drawing', () => {
    show({ report: WIDE, readAt: SEEN })
    const bar = host('context-bar')
    expect(flat(bar.props.style)).toMatchObject({
      height: 8,
      borderRadius: 4,
      overflow: 'hidden',
      flexDirection: 'row',
      backgroundColor: palette[9]
    })
    const segments = hosts('context-bar-segment-')
    // System tools (slot 1) and the autocompact buffer (slot 8): the rest are under half a percent.
    expect(segments.map((segment) => flat(segment.props.style).backgroundColor)).toEqual([palette[1], palette[8]])
    // Each as its share of the bar's width (the app gives them weights and a spacer for the rest).
    expect(Number.parseFloat(String(flat(segments[0]!.props.style).width)) / 100).toBeCloseTo(23_800 / 1_000_081, 9)
    expect(Number.parseFloat(String(flat(segments[1]!.props.style).width)) / 100).toBeCloseTo(33_000 / 1_000_081, 9)
    expect(bar.props.accessibilityRole).toBe('progressbar')
    expect(bar.props.accessibilityLabel).toBe('3% of context window used')
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 3 })
  })

  it('says N of M tokens, the model and how old the table is under the bar, in the secondary text colour', () => {
    show({ report: WIDE, readAt: SEEN })
    const caption = host('context-caption')
    expect(words(caption)).toEqual(['32.8k of 1M tokens · Haiku 5.5 · Updated 9 min ago'])
    const text = caption.find((node) => (node.type as unknown) === 'Text')
    expect(flat(text.props.style).color).toBe(colors.textSecondary)
  })

  it('leaves out the age of a table that was already on the screen when the phone looked', () => {
    show({ report: WIDE, readAt: null })
    expect(words(host('context-caption'))).toEqual(['32.8k of 1M tokens · Haiku 5.5'])
  })

  it('starts collapsed: the header says the share, and no legend is drawn', () => {
    show({ report: WIDE, readAt: SEEN })
    const header = host('context-categories-toggle')
    expect(words(header)).toEqual(['By category', '3%'])
    expect(header.props.accessibilityRole).toBe('button')
    expect(header.props.accessibilityState).toEqual({ expanded: false })
    expect(flat(header.props.style).minHeight).toBe(48)
    expect(hosts('context-legend-row-')).toHaveLength(0)
  })

  it('opens to the legend, each row a dot in its colour, the name, the tokens and the percent', () => {
    show({ report: WIDE, readAt: SEEN })
    press('context-categories-toggle')
    expect(host('context-categories-toggle').props.accessibilityState).toEqual({ expanded: true })
    const rows = hosts('context-legend-row-')
    expect(rows.map((row) => words(row))).toEqual([
      ['System tools', '23.8k', '2.4%'],
      ['System prompt', '5k', '0.5%'],
      ['Skills', '2.7k', '0.3%'],
      ['MCP server instructions', '717', '0.1%'],
      ['MCP tools', '631', '0.1%'],
      ['Memory files', '23', '0.0%'],
      ['Messages', '10', '0.0%'],
      ['Autocompact buffer', '33k', '3.3%'],
      ['Free space', '934.2k', '93.4%']
    ])
    const dots = hosts('context-legend-dot-').map((dot) => flat(dot.props.style).backgroundColor)
    expect(dots).toEqual([
      palette[1], palette[2], palette[3], palette[4], palette[7], palette[7], palette[7], palette[8], palette[9]
    ])
    // The name reads at the text colour, the figures at the secondary one.
    const first = rows[0]!.findAll((node) => (node.type as unknown) === 'Text')
    expect(flat(first[0]!.props.style).color).toBe(colors.text)
    expect(flat(first[1]!.props.style).color).toBe(colors.textSecondary)
  })

  it('draws the MCP summary Claude Code printed, under the section\'s own header with its total', () => {
    show({ report: WIDE, readAt: SEEN })
    press('context-categories-toggle')
    const header = host('context-section-mcp')
    expect(words(header)).toEqual(['MCP tools', '631'])
    expect(hasHost('context-section-rows-mcp')).toBe(false)
    press('context-section-mcp')
    expect(words(host('context-section-rows-mcp'))).toEqual(['147 tools · 631 tokens'])
  })

  it('draws the custom agents of /context all, with their tokens', () => {
    show({ report: ALL, readAt: SEEN })
    press('context-categories-toggle')
    press('context-section-agents')
    expect(words(host('context-section-rows-agents'))).toEqual(['capture-reviewer', '27'])
  })

  it('shows twelve rows of a long section and then "Show 10 more", and the rest on a tap', () => {
    show({ report: ALL, readAt: SEEN })
    press('context-categories-toggle')
    press('context-section-mcp')
    const shown = (): string[] => words(host('context-section-rows-mcp'))
    expect(shown()).toHaveLength(12 + 1)
    expect(shown().at(-1)).toBe('Show 10 more')
    press('context-section-more-mcp')
    expect(shown()).toHaveLength(22)
    expect(hasHost('context-section-more-mcp')).toBe(false)
    // A tool with no figure is a name alone.
    expect(shown()[0]).toBe('mcp__claude-in-chrome__browser_batch')
  })

  it('closes the whole legend on "Show less"', () => {
    show({ report: WIDE, readAt: SEEN })
    press('context-categories-toggle')
    expect(words(host('context-show-less'))).toEqual(['Show less'])
    press('context-show-less')
    expect(hosts('context-legend-row-')).toHaveLength(0)
    expect(host('context-categories-toggle').props.accessibilityState).toEqual({ expanded: false })
  })

  it('draws a one-row table: free space and nothing in the bar', () => {
    show({
      report: {
        ...WIDE,
        usedTokens: 0,
        usedPercent: 0,
        categories: [{ name: 'Free space', tokens: 1_000_000, percent: 100, kind: 'free' }],
        sections: []
      },
      readAt: SEEN
    })
    expect(hosts('context-bar-segment-')).toHaveLength(0)
    press('context-categories-toggle')
    expect(hosts('context-legend-row-')).toHaveLength(1)
  })
})
