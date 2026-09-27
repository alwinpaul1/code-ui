// The new-worktree form sheet in both themes. Before the theme-review fix it painted from the
// static dark palette (`../theme/mobile-theme`), so the "Create worktree" title, field labels and
// the primary Create button stayed dark-palette colours on a light session. Modelled on
// `mobile-web-shell/PageRouteUnavailableScreen.theme.test.tsx`.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { WorkspaceSshGate } from '../tasks/workspace-ssh-gate'
import { NewWorktreeFormSheet } from './NewWorktreeFormSheet'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp' }))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./NewWorktreeProjectTargetFields', () => ({
  NewWorktreeProjectTargetFields: 'NewWorktreeProjectTargetFields'
}))
vi.mock('./SmartWorkspaceSourceField', () => ({
  SmartWorkspaceSourceField: 'SmartWorkspaceSourceField'
}))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

const sshGate: WorkspaceSshGate = {
  requiresConnection: false,
  status: 'connected',
  connectInProgress: false,
  error: null
} as unknown as WorkspaceSshGate

const baseProps = {
  visible: true,
  interactive: true,
  loading: false,
  hasRepos: true,
  project: { label: 'orca' },
  runTarget: { label: 'local' },
  projectBadgeColor: null,
  selectedRepoIsGit: true,
  selectedRepoConnectionId: null,
  selectedRepoName: 'orca',
  sshGate,
  composer: { forkPushWarning: null } as never,
  selectedAgent: { id: 'claude', label: 'Claude Code' } as never,
  showAdvanced: false,
  note: '',
  setupCommand: null,
  setupSource: null,
  setupRunPolicy: 'ask' as const,
  setupDecisionChoice: null,
  runSetup: false,
  error: '',
  creating: false,
  canCreate: true,
  onClose: () => undefined,
  onOpenProject: () => undefined,
  onOpenRunTarget: () => undefined,
  onOpenSource: () => undefined,
  onClearError: () => undefined,
  onConnect: () => undefined,
  onOpenAgent: () => undefined,
  onShowAdvancedChange: () => undefined,
  onNoteChange: () => undefined,
  onSetupDecisionChange: () => undefined,
  onRunSetupChange: () => undefined,
  onCreate: () => undefined
}

describe('the new-worktree form sheet', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the title, the Agent label and the Create button from the %s theme', (
    scheme,
    palette
  ) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <NewWorktreeFormSheet {...baseProps} />
        </ThemeProvider>
      )
    })
    // "Create worktree" appears twice: the header title, then the button's own
    // label (asserted separately below, by style) — the header renders first.
    const [title] = renderer!.root.findAllByProps({ children: 'Create worktree' })
    expect(styleOf(title!).color).toBe(palette.text)
    const label = renderer!.root.findByProps({ children: 'Agent' })
    expect(styleOf(label).color).toBe(palette.textSecondary)
    // The create button is the Pressable with a fixed 160 minWidth — its own text
    // reads "Create worktree" too, so it is located by style, not by its label.
    const createButton = renderer!.root
      .findAll((node) => (node.type as unknown) === 'Pressable')
      .find((node) => styleOf(node).minWidth === 160)
    expect(createButton).toBeDefined()
    expect(styleOf(createButton!).backgroundColor).toBe(palette.text)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the empty state from the %s theme when there are no repos', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <NewWorktreeFormSheet {...baseProps} hasRepos={false} />
        </ThemeProvider>
      )
    })
    const empty = renderer!.root.findByProps({ children: 'No projects found' })
    expect(styleOf(empty).color).toBe(palette.textSecondary)
  })
})
