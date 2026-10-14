import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))

import { darkContextCategoryPalette, lightContextCategoryPalette } from '../theme/context-category-palette'
import { ThemeProvider } from '../theme/theme-context'
import { readClaudeContextReport } from './claude-context-report'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

// The category card in the context sheet: the table Claude Code 2.1.300 printed for `/context`
// (fixtures/claude-context-2.1.300/), under the live figure the ring is drawn from. Codex prints no
// table (codex-cli 0.153.4 `/status` has a context figure and the usage windows), so its sheet is the
// totals it always was.
const TABLE = readClaudeContextReport(
  readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300/context-130-cols.txt'), 'utf8').split('\n')
)!
const SEEN = new Date(2026, 9, 14, 21, 30).getTime()

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 14, 21, 39))
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

const words = (root: ReactTestInstance = renderer!.root): string[] =>
  root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
const hasHost = (id: string): boolean =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string').length > 0
function flat(style: unknown): Record<string, unknown> {
  const list = [style].flat(Infinity)
  return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'))
}

function open(scheme: 'light' | 'dark', context: TerminalHudContextWindow | null) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileContextWindowSheet visible context={context} onClose={() => {}} />
      </ThemeProvider>
    )
  })
}

const claude: TerminalHudContextWindow = {
  usedPercent: 22,
  usedLabel: '217k',
  windowLabel: '1.0M',
  breakdown: { report: TABLE, readAt: SEEN }
}

describe.each([
  ['light', lightContextCategoryPalette],
  ['dark', darkContextCategoryPalette]
] as const)('the context sheet with a /context table, in %s mode', (scheme, palette) => {
  it('keeps the live figure on top and draws the table under it, with its own totals and age', () => {
    open(scheme, claude)
    const drawn = words()
    expect(drawn).toEqual(
      expect.arrayContaining([
        'Context window',
        '217k / 1.0M (22%)',
        'By category',
        '3%',
        '32.8k of 1M tokens · Haiku 5.5 · Updated 9 min ago'
      ])
    )
    // The live figure is first: the sheet agrees with the ring before it says anything older.
    expect(drawn.indexOf('217k / 1.0M (22%)')).toBeLessThan(drawn.indexOf('By category'))
  })

  it('draws the bar on the scheme\'s own track', () => {
    open(scheme, claude)
    const bar = renderer!.root.find((node) => node.props.testID === 'context-bar' && typeof node.type === 'string')
    expect(flat(bar.props.style).backgroundColor).toBe(palette[9])
  })
})

describe('the context sheet without a table', () => {
  it('is the totals alone for Claude before /context has been run', () => {
    open('light', { usedPercent: 22, usedLabel: '217k', windowLabel: '1.0M' })
    expect(hasHost('context-categories')).toBe(false)
    expect(words()).toEqual(['Context window', '217k / 1.0M (22%)'])
  })

  it('is the totals and the windows for Codex, which has no table to draw', () => {
    open('dark', {
      usedPercent: 3,
      usedLabel: '19.5K',
      windowLabel: '258K',
      limits: [{ name: 'Session', usedPercent: 50, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }]
    })
    expect(hasHost('context-categories')).toBe(false)
    expect(words()).toEqual(expect.arrayContaining(['Context window', '19.5K / 258K (3%)', 'Session']))
  })
})
