/**
 * Tapping a Claude tab's context ring opens the Claude app's "Usage" sheet (2026-10-15
 * screenshots), not Code UI's old one-line "Context window 128k / 400k (32%)" card. No chevron,
 * no breakdown (the user: "No need of this"). Both themes are drawn from the theme's tokens.
 */
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? createElement('BottomDrawer', null, children) : null)
}))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined), has: () => true }))
vi.mock('../storage/auto-mode-opt-in', () => ({ loadAutoModeOptedIn: async () => false, saveAutoModeOptedIn: async () => undefined }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ClaudeUsageSheet, type ClaudeUsageSheetData } from './ClaudeUsageSheet'
import { MobileNativeChatComposerSheets } from './MobileNativeChatComposerSheets'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function texts(root: ReactTestInstance): string[] {
  return root.findAll((node) => String(node.type) === 'Text').map((node) => [node.props.children].flat().join(''))
}

const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter((s) => s && typeof s === 'object'))

const data = (overrides: Partial<ClaudeUsageSheetData> = {}): ClaudeUsageSheetData => ({
  context: { answer: { usedTokens: 145_500, windowTokens: 400_000, percent: 36 }, figure: null, ask: 'idle' },
  plan: {
    rows: [
      { kind: 'session', percent: 28, resetsAt: null, modelName: null },
      { kind: 'weekly_all', percent: 11, resetsAt: null, modelName: null },
      { kind: 'weekly_scoped', percent: 3, resetsAt: null, modelName: 'Fable' }
    ],
    failed: false
  },
  refreshing: false,
  onRefresh: () => undefined,
  ...overrides
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the Usage sheet in a %s session', (scheme, palette) => {
  it('reads as the Claude app’s: Usage, Context, Plan usage, Weekly limits', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeUsageSheet visible data={data()} onClose={() => undefined} />
        </ThemeProvider>
      )
    })
    expect(texts(renderer!.root)).toEqual([
      'Usage',
      'Context',
      'Context window', '36% used', '145.5k of 400k tokens',
      'Plan usage',
      'Current session', '28% used',
      'Weekly limits',
      'All models', '11% used',
      'Fable only', '3% used'
    ])
  })

  it('has no chevron and no breakdown on the context card', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeUsageSheet visible data={data()} onClose={() => undefined} />
        </ThemeProvider>
      )
    })
    expect(renderer!.root.findAll((node) => /Chevron/.test(String(node.type)))).toHaveLength(0)
    expect(texts(renderer!.root).some((text) => /MCP tools|Memory files|Custom agents|Show less/.test(text))).toBe(false)
  })

  it('fills its bars in the theme’s colours: info, warning from 75%, danger from 90%', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeUsageSheet
            visible
            data={data({ plan: { rows: [{ kind: 'session', percent: 80, resetsAt: null, modelName: null }, { kind: 'weekly_all', percent: 95, resetsAt: null, modelName: null }], failed: false } })}
            onClose={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const fills = renderer!.root.findAll((node) => node.props.testID === 'usage-meter-fill').map((node) => flat(node.props.style).backgroundColor)
    expect(fills).toEqual([palette.info, palette.warning, palette.danger])
  })

  it('refreshes on the refresh button, and closes on the cross', () => {
    const onRefresh = vi.fn()
    const onClose = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeUsageSheet visible data={data({ onRefresh })} onClose={onClose} />
        </ThemeProvider>
      )
    })
    act(() => renderer!.root.find((node) => node.props.accessibilityLabel === 'Refresh usage').props.onPress())
    act(() => renderer!.root.find((node) => node.props.accessibilityLabel === 'Close').props.onPress())
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows Loading for the plan while the tab’s account is not known, and the unanswered line', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeUsageSheet visible data={data({ context: { answer: null, figure: null, ask: 'unanswered' }, plan: null })} onClose={() => undefined} />
        </ThemeProvider>
      )
    })
    const all = texts(renderer!.root)
    expect(all).toContain('The session didn’t respond. Tap the refresh button to try again.')
    expect(all.filter((text) => text === 'Loading')).toHaveLength(2)
  })
})

describe('the context ring on a Claude tab', () => {
  const composerSheets = (show: boolean, claudeUsage: { data: ClaudeUsageSheetData; onOpen: () => void } | null) => (
    <ThemeProvider initialPreference="dark">
      <MobileNativeChatComposerSheets
        showModeSheet={false}
        onCloseModeSheet={() => undefined}
        permissionMode={null}
        showContextSheet={show}
        onCloseContextSheet={() => undefined}
        contextWindow={{ usedPercent: 32, usedLabel: '128k', windowLabel: '400k' }}
        claudeUsage={claudeUsage}
      />
    </ThemeProvider>
  )

  it('opens the Usage sheet and asks the session once, not the old one-line card', () => {
    const onOpen = vi.fn()
    act(() => {
      renderer = create(composerSheets(false, { data: data(), onOpen }))
    })
    expect(onOpen).not.toHaveBeenCalled()
    act(() => renderer!.update(composerSheets(true, { data: data(), onOpen })))
    const all = texts(renderer!.root)
    expect(all[0]).toBe('Usage')
    expect(all).not.toContain('128k / 400k (32%)')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('keeps the old card for a tab with no Claude usage (Codex)', () => {
    act(() => {
      renderer = create(composerSheets(true, null))
    })
    expect(texts(renderer!.root)).toContain('128k / 400k (32%)')
  })
})
