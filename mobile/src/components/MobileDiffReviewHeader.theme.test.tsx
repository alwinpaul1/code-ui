// The diff review screen's own header in both themes. Before the theme-review fix it painted
// from the static dark palette (`../theme/mobile-theme`), so the "Changes" title, the worktree
// subtitle and the back/actions icons stayed dark-palette colours on a light session. Modelled on
// `mobile-web-shell/PageRouteUnavailableScreen.theme.test.tsx`.

import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileDiffReviewHeader } from './MobileDiffReviewHeader'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  FlatList: ({
    data,
    renderItem
  }: {
    data: string[]
    renderItem: (info: { item: string }) => ReactElement
  }) =>
    createElement(
      'FlatList',
      null,
      data.map((item) => createElement('Row', { key: item }, renderItem({ item })))
    ),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ListChecks: 'ListChecks',
  MessageSquare: 'MessageSquare',
  MoreHorizontal: 'MoreHorizontal'
}))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw = typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

const baseProps = {
  filter: 'all' as const,
  isWideLayout: false,
  prSidebarIsGithubRepo: false,
  prSidebarCanDock: false,
  queueLength: 4,
  reviewedCount: 1,
  unsentCount: 2,
  worktreeLabel: 'feature/review',
  onBack: () => undefined,
  onOpenActions: () => undefined,
  onOpenQueuedNotes: () => undefined,
  onOpenPRSidebar: () => undefined,
  onSelectFilter: () => undefined
}

describe('the diff review screen header', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the title, subtitle and toolbar icons from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewHeader {...baseProps} />
        </ThemeProvider>
      )
    })
    const header = renderer!.root.findByType('View' as never)
    expect(styleOf(header).borderBottomColor).toBe(palette.border)
    const title = renderer!.root.findByProps({ children: 'Changes' })
    expect(styleOf(title).color).toBe(palette.text)
    const subtitle = renderer!.root.findByProps({ children: 'feature/review' })
    expect(styleOf(subtitle).color).toBe(palette.textMuted)
    const backIcon = renderer!.root.findByType('ChevronLeft' as never)
    expect(backIcon.props.color).toBe(palette.text)
    const filterChip = renderer!.root.findByProps({ accessibilityLabel: 'Show all review files' })
    expect(styleOf(filterChip).backgroundColor).toBe(palette.text)
  })

  // The Claude app's "N queued comments, tap to view" chip (`o330.b`, com.anthropic.claude
  // 1.261009.20) stands where "2 unsent notes" was: it names the comments waiting to be sent, and
  // a tap opens where they are sent from.
  it('shows the unsent notes as the queued comments chip, and opens the send sheet from it', () => {
    const onOpenQueuedNotes = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileDiffReviewHeader {...baseProps} onOpenQueuedNotes={onOpenQueuedNotes} />
        </ThemeProvider>
      )
    })
    const chip = renderer!.root.findByProps({ accessibilityLabel: '2 queued comments, tap to view' })
    expect(renderer!.root.findByProps({ children: '2 comments' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ children: '2 unsent notes' })).toHaveLength(0)
    act(() => chip.props.onPress())
    expect(onOpenQueuedNotes).toHaveBeenCalledTimes(1)
  })

  it('draws no chip, and no "0 unsent notes", when nothing is waiting', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="dark">
          <MobileDiffReviewHeader {...baseProps} unsentCount={0} />
        </ThemeProvider>
      )
    })
    expect(renderer!.root.findAllByType('MessageSquare' as never)).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ children: '0 unsent notes' })).toHaveLength(0)
  })
})
