// The PR sidebar's main panel in both themes. Upstream (and this fork, before the
// theme-sweep pass) painted it from the static dark-only `mobile-theme` palette, so a
// light-mode session still saw a dark card here — the same bug the sweep exists to fix,
// reported on the Files/Terminal/Browser/Voice screens but present across every screen
// that imported the legacy `colors` object, this one included.
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { ConnectionState } from '../transport/types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ RotateCw: 'RotateCw' }))
// Not reached by the 'error' branch under test, but statically imported by
// MobilePRSidebar.tsx, so they must resolve to something under the react-native
// mock above rather than pull in their own real icon/native-module trees.
vi.mock('./pr-sidebar/PRSidebarHeader', () => ({ PRSidebarHeader: 'PRSidebarHeader' }))
vi.mock('./pr-sidebar/PRConflictingFilesSection', () => ({
  PRConflictingFilesSection: 'PRConflictingFilesSection'
}))
vi.mock('./pr-sidebar/PRActionsSection', () => ({ PRActionsSection: 'PRActionsSection' }))
vi.mock('./pr-sidebar/PRReviewersSection', () => ({ PRReviewersSection: 'PRReviewersSection' }))
vi.mock('./pr-sidebar/PRChecksSection', () => ({ PRChecksSection: 'PRChecksSection' }))
vi.mock('./pr-sidebar/PRCommentsSection', () => ({ PRCommentsSection: 'PRCommentsSection' }))
vi.mock('./pr-sidebar/PrSidebarCreateEmptyState', () => ({
  PrSidebarCreateEmptyState: 'PrSidebarCreateEmptyState'
}))

const { MobilePRSidebar } = await import('./MobilePRSidebar')

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

describe('the PR sidebar main panel error state', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the retry button and message from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobilePRSidebar
            state={{ kind: 'error', message: 'Could not load pull request.' }}
            onRetry={() => undefined}
            refetch={() => undefined}
            client={null}
            connState={'disconnected' satisfies ConnectionState}
            worktreeId="worktree-1"
            gitBranch={null}
            gitStatus={null}
            headSha={null}
          />
        </ThemeProvider>
      )
    })

    const message = textWithChildren(renderer!, 'Could not load pull request.')
    expect(message).toBeDefined()
    expect(styleOf(message!).color).toBe(palette.textSecondary)

    const retryButton = renderer!.root.findByType('Pressable' as never)
    expect(styleOf(retryButton).backgroundColor).toBe(palette.bgRaised)

    const retryText = textWithChildren(renderer!, 'Retry')
    expect(retryText).toBeDefined()
    expect(styleOf(retryText!).color).toBe(palette.text)

    const icon = renderer!.root.findByType('RotateCw' as never)
    expect(icon.props.color).toBe(palette.text)
  })
})
