// The PR sidebar's actions section (Merge/Close/Unlink) in both themes: the
// secondary action buttons' fill, border and label came from the static
// dark-only `mobile-theme` palette before the theme-sweep pass, so a light-mode
// session still saw a dark button here. The merge button's green stays the same
// named constant in both schemes on purpose (the brief), so this test covers the
// buttons that DO follow the theme: Close/Unlink.
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../../src/shared/github/pull-request-types'
import { darkColors, lightColors } from '../../theme/tokens'
import { ThemeProvider } from '../../theme/theme-context'
import { useMobilePrActions } from '../../session/use-mobile-pr-actions'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ GitMerge: 'GitMerge', Link2Off: 'Link2Off' }))
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }))

const { PRActionsSection } = await import('./PRActionsSection')

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

function textWithChildren(renderer: ReactTestRenderer, text: string) {
  return renderer.root
    .findAllByType('Text' as never)
    .find((node) => node.props.children === text)
}

// Open, mergeable PR with no review/queue requirements: shows the Merge button
// (unthemed green, out of scope here) and the Close/Unlink secondary row, whose
// buttons ARE themed.
const PR: PRInfo = {
  number: 1,
  title: 'A pull request',
  state: 'open',
  url: '',
  checksStatus: 'success',
  updatedAt: '',
  mergeable: 'MERGEABLE'
}

// A real `useMobilePrActions()` rather than a hand-built fake: `resolveState` /
// `resolveAutoMerge` are engine methods, not plain props, so a fake risks
// drifting from the real shape. `client: null` keeps every mutation a no-op.
function Harness() {
  const actions = useMobilePrActions({
    client: null,
    connState: 'disconnected',
    worktreeId: 'worktree-1',
    prNumber: PR.number,
    headSha: null,
    prRepo: null,
    refetch: () => undefined
  })
  return (
    <PRActionsSection
      pr={PR}
      actions={actions}
      client={null}
      worktreeId="worktree-1"
      onUnlinked={() => undefined}
    />
  )
}

describe('the PR sidebar actions section, Close/Unlink buttons', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the secondary action buttons from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Harness />
        </ThemeProvider>
      )
    })

    const closeLabel = textWithChildren(renderer!, 'Close')
    expect(closeLabel).toBeDefined()
    expect(styleOf(closeLabel!).color).toBe(palette.danger)

    const unlinkLabel = textWithChildren(renderer!, 'Unlink')
    expect(unlinkLabel).toBeDefined()
    expect(styleOf(unlinkLabel!).color).toBe(palette.text)

    const unlinkButton = renderer!.root.findByProps({ accessibilityLabel: 'Unlink pull request' })
    expect(styleOf(unlinkButton).backgroundColor).toBe(palette.bgRaised)
    expect(styleOf(unlinkButton).borderColor).toBe(palette.border)
  })
})
