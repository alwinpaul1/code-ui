import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A linked PR's state colour outside the PR sidebar, in both themes: the workspace list row's
 * `#123` badge and the source-control branch card's PR chip (its state pill and check rollup).
 * `statusColor` took its palette as an optional parameter defaulting to `darkColors`, and these
 * two callers passed none, so a light session drew the dark scheme's green, red and violet on the
 * light canvas (the merged violet at 2.4:1). The palette is required now; these pin the result.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  AlertTriangle: 'AlertTriangle',
  Bell: 'Bell',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleDot: 'CircleDot',
  GitBranch: 'GitBranch',
  GitMerge: 'GitMerge',
  GitPullRequest: 'GitPullRequest',
  MessageSquare: 'MessageSquare',
  Monitor: 'Monitor',
  Server: 'Server',
  StickyNote: 'StickyNote',
  X: 'X'
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('./AgentSpinner', () => ({ AgentSpinner: () => null }))
vi.mock('./MobileRepoIcon', () => ({ MobileRepoIcon: () => null }))
vi.mock('./WorktreeAgentList', () => ({ WorktreeAgentList: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileSourceControlPrChip } from '../source-control/MobileSourceControlPrChip'
import { WorktreeListRow, type WorktreeListRowItem } from './WorktreeListRow'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(
  scheme: 'light' | 'dark',
  element: ReturnType<typeof createElement>
): ReactTestInstance {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{element}</ThemeProvider>)
  })
  return renderer!.root
}

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

const textNode = (root: ReactTestInstance, text: string) =>
  root.find(
    (node) => String(node.type) === 'Text' && [node.props.children].flat().join('') === text
  )

function row(state: string): WorktreeListRowItem {
  return {
    worktreeId: 'worktree-1',
    repo: 'orca',
    branch: 'feature/mobile-list',
    displayName: 'mobile-list',
    liveTerminalCount: 0,
    preview: '',
    unread: false,
    linkedPR: { number: 123, state }
  }
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('a linked PR state colour in a %s session', (scheme, palette) => {
  const mode = scheme as 'light' | 'dark'

  it.each([
    ['open', 'success'],
    ['closed', 'danger'],
    ['merged', 'mergedPurple']
  ] as const)('draws the workspace row badge for a %s PR in the theme colour', (state, token) => {
    const root = render(
      mode,
      createElement(WorktreeListRow, {
        item: row(state),
        isReadOnly: false,
        now: 0,
        repoColor: '#000000',
        status: 'inactive',
        onPress: () => undefined
      })
    )
    expect(root.find((node) => String(node.type) === 'GitPullRequest').props.color).toBe(
      palette[token]
    )
    expect(flat(textNode(root, '#123').props.style).color).toBe(palette[token])
  })

  it("draws the branch card's PR chip pill and check rollup in the theme colours", () => {
    const root = render(
      mode,
      createElement(MobileSourceControlPrChip, {
        summary: {
          kind: 'ready',
          number: 42,
          stateLabel: 'Open',
          stateToken: 'statusGreen',
          rollup: { kind: 'failing', text: '2 failing', token: 'statusRed' },
          commentCount: 0
        },
        onPress: () => undefined
      })
    )
    const label = textNode(root, 'Open')
    expect(flat(label.props.style).color).toBe(palette.success)
    expect(flat(label.parent!.props.style).borderColor).toBe(palette.success)
    expect(flat(textNode(root, '2 failing').props.style).color).toBe(palette.danger)
    expect(root.find((node) => String(node.type) === 'X').props.color).toBe(palette.danger)
  })
})
