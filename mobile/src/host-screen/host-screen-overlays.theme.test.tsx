import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The host screen's overlays in both themes: the Filter drawer, the Sort By / Group By pickers,
 * a workspace's long-press action sheet, its inline Delete confirmation and the Remove Host
 * confirmation. HostScreenOverlays painted from the LEGACY static palette (`mobile-theme.ts`),
 * dark-only, until the 2026-09-27 sweep, and nothing rendered it in a test: the host screen's own
 * test mocks it to null.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Edit3: 'Edit3',
  GitBranch: 'GitBranch',
  Moon: 'Moon',
  Trash2: 'Trash2'
}))
// The drawer's own sheet is a native modal with gestures; here it only shows its children while
// open, which is all that is under test.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))
vi.mock('../components/NewWorktreeModalController', () => ({
  NewWorktreeModalController: () => null
}))
vi.mock('../agent-history/MobileAgentSessionHistoryIcon', () => ({
  MobileAgentSessionHistoryIcon: 'MobileAgentSessionHistoryIcon'
}))
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn(), triggerMediumImpact: vi.fn() }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { HostScreenOverlays } from './host-screen-overlays'
import type { HostScreenController } from './use-host-screen-controller'

const WORKTREE = {
  worktreeId: 'wt-1',
  repo: 'orca',
  branch: 'feature/theme',
  displayName: 'theme',
  unread: false,
  isArchived: false
}

type OverlayState = {
  showSortPicker?: boolean
  showFilterModal?: boolean
  actionTarget?: typeof WORKTREE | null
  confirmDelete?: typeof WORKTREE | null
  confirmRemoveHost?: boolean
}

function controllerFor(open: OverlayState): HostScreenController {
  const noop = () => undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double carrying every field HostScreenOverlays reads while the overlays named in `open` are shown.
  return {
    actions: {
      handleDeleteWorktree: noop,
      navigateFromHostList: noop,
      togglePin: noop,
      toggleArchive: noop,
      markUnread: noop,
      handleRemoveHost: noop,
      setShowNewWorktreeVisible: noop
    },
    catalog: { fetchWorktrees: noop },
    client: null,
    existingWorktreePaths: [],
    hostCapabilities: [],
    hostId: 'host-1',
    settings: {
      handleSortChange: noop,
      handleGroupChange: noop,
      activeFilterCount: 1,
      clearFilters: noop,
      toggleHideSleeping: noop,
      toggleHideDefaultBranch: noop,
      toggleShowArchived: noop,
      toggleRepoFilter: noop
    },
    showNewWorktree: false,
    sectionsResult: {
      uniqueRepos: [
        { id: 'r1', name: 'orca', color: '#f97316' },
        { id: 'r2', name: 'code-ui', color: '#8b5cf6' }
      ]
    },
    state: {
      showSortPicker: open.showSortPicker ?? false,
      showGroupPicker: false,
      sortMode: 'recent',
      groupMode: 'none',
      setShowSortPicker: noop,
      setShowGroupPicker: noop,
      showFilterModal: open.showFilterModal ?? false,
      setShowFilterModal: noop,
      filters: {
        hideSleeping: true,
        hideDefaultBranch: false,
        showArchived: false,
        filterRepoIds: new Set()
      },
      actionTarget: open.actionTarget ?? null,
      setActionTarget: noop,
      confirmDelete: open.confirmDelete ?? null,
      setConfirmDelete: noop,
      setSleptIds: noop,
      pinnedIds: new Set(),
      confirmRemoveHost: open.confirmRemoveHost ?? false,
      setConfirmRemoveHost: noop,
      hostName: 'Studio Mac',
      newWorktreeModalRef: { current: null },
      newWorktreeModalVisibleRef: { current: false },
      worktrees: []
    }
  } as unknown as HostScreenController
}

function flat(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? style({ pressed: false }) : style
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(scheme: 'light' | 'dark', open: OverlayState): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <HostScreenOverlays controller={controllerFor(open)} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

/** The Text node drawing exactly `children` (a Txt renders one host Text). */
const text = (root: ReactTestInstance, children: string): ReactTestInstance =>
  root.findAll(
    (node) => String(node.type) === 'Text' && [node.props.children].flat().join('') === children
  )[0]!

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])("the host screen's overlays in a %s session", (scheme, palette) => {
  const mode = scheme as 'light' | 'dark'

  it('draws the Filter drawer from the theme', () => {
    const root = render(mode, { showFilterModal: true })
    expect(flat(text(root, 'Filter').props.style).color).toBe(palette.text)
    expect(flat(text(root, 'Clear filters').props.style).color).toBe(palette.textSecondary)
    expect(flat(text(root, 'Workspaces').props.style).color).toBe(palette.textMuted)
    const hideSleeping = text(root, 'Hide sleeping')
    expect(flat(hideSleeping.props.style).color).toBe(palette.text)
    expect(flat(hideSleeping.parent!.parent!.props.style).backgroundColor).toBe(palette.bgPanel)
    // The one active filter's check mark.
    expect(root.find((node) => String(node.type) === 'Check').props.color).toBe(palette.text)
  })

  it('draws the Sort By picker from the theme', () => {
    const root = render(mode, { showSortPicker: true })
    // A quiet label over the options, which read in the body colour.
    expect(flat(text(root, 'Sort By').props.style).color).toBe(palette.textMuted)
    const [firstOption] = root.findAll(
      (node) => String(node.type) === 'Text' && flat(node.props.style).color === palette.text
    )
    expect(firstOption).toBeDefined()
  })

  it("draws a workspace's action sheet from the theme", () => {
    const root = render(mode, { actionTarget: WORKTREE })
    expect(flat(text(root, 'theme').props.style).color).toBe(palette.textMuted)
    expect(flat(text(root, 'feature/theme').props.style).color).toBe(palette.textMuted)
    expect(flat(text(root, 'Sleep').props.style).color).toBe(palette.text)
    expect(flat(text(root, 'Delete').props.style).color).toBe(palette.danger)
  })

  it('draws the inline Delete confirmation from the theme', () => {
    const root = render(mode, { actionTarget: WORKTREE, confirmDelete: WORKTREE })
    expect(flat(text(root, 'Delete Worktree').props.style).color).toBe(palette.text)
    const cancel = text(root, 'Cancel')
    expect(flat(cancel.props.style).color).toBe(palette.textSecondary)
    expect(flat(cancel.parent!.props.style).backgroundColor).toBe(palette.bgPanel)
    const destructive = text(root, 'Delete')
    expect(flat(destructive.parent!.props.style).backgroundColor).toBe(palette.danger)
    // White on the red fill in both schemes, as the platform draws its own destructive buttons.
    expect(flat(destructive.props.style).color).toBe('#ffffff')
  })

  it('draws the Remove Host confirmation from the theme', () => {
    const root = render(mode, { confirmRemoveHost: true })
    expect(flat(text(root, 'Remove Host').props.style).color).toBe(palette.text)
  })
})
