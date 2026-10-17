import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The viewer's own sign-in state (reported 2026-10-17): signed in under Settings, an artifact
// still opened on claude.ai's "Sign in to view this page" with no way forward, and the bar's
// Open in browser was the obvious button, though a browser sign-in cannot reach the app.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }))
vi.mock('react-native-webview', async () => {
  const React = await import('react')
  return { WebView: (props: Record<string, unknown>) => React.createElement('WebView', props) }
})
vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))
const outside = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./open-outside-app', () => ({ openUrlOutsideApp: outside }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: (props: Record<string, unknown>) => createElement('ConfirmModal', props) }))
vi.mock('./claude-artifact-shortcut', () => ({ pinClaudeArtifactShortcut: vi.fn() }))

import { ThemeProvider } from '../theme/theme-context'
import {
  ARTIFACT_VIEWER_NO_ACCOUNT,
  ARTIFACT_VIEWER_OPEN_ACCOUNTS,
  ARTIFACT_VIEWER_PICK_ACCOUNT,
  artifactViewerSignInAgain,
  type ArtifactViewerSignIn
} from './ArtifactViewerSignInState'
import { MobileArtifactViewer } from './MobileArtifactViewer'
import { PUBLISHED_LINK, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  outside.mockClear()
})

function mount(signIn: ArtifactViewerSignIn | null, scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileArtifactViewer url={PUBLISHED_LINK} uuid={PUBLISHED_UUID} title="Board" signIn={signIn} onClose={vi.fn()} />
      </ThemeProvider>
    )
  })
}
const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const webviews = () => renderer!.root.findAll((node) => (node.type as unknown) === 'WebView')
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const needed = (over: Partial<Extract<ArtifactViewerSignIn, { kind: 'needed' }>> = {}): Extract<ArtifactViewerSignIn, { kind: 'needed' }> => ({
  kind: 'needed',
  accountId: 'acct-work',
  label: 'NexDash',
  choices: [
    { id: 'acct-personal', label: 'Account 1' },
    { id: 'acct-work', label: 'NexDash' }
  ],
  onOpenAccounts: vi.fn(),
  onPick: vi.fn(),
  ...over
})

describe('before the session is in', () => {
  it('mounts no WebView while the account’s session is written, and shows the Clawd cover under the bar', () => {
    mount({ kind: 'checking' })
    expect(webviews()).toHaveLength(0)
    expect(host('artifact-viewer-loading')).toBeDefined()
    expect(host('artifact-viewer-bar')).toBeDefined()
  })

  it('loads the page as before with no sign-in state', () => {
    mount(null)
    expect(webviews()).toHaveLength(1)
  })
})

describe("the viewer's sign-in state", () => {
  it("says to sign in to the account again in Anthropic accounts, in place of claude.ai's dead page, and opens that screen", () => {
    const state = needed()
    mount(state)
    expect(webviews()).toHaveLength(0)
    const all = texts(host('artifact-viewer-sign-in')!)
    expect(all).toContain('Sign in to NexDash again in Anthropic accounts to open artifacts.')
    expect(artifactViewerSignInAgain('NexDash')).toBe('Sign in to NexDash again in Anthropic accounts to open artifacts.')
    expect(all).toContain(ARTIFACT_VIEWER_OPEN_ACCOUNTS)
    // No claude.ai sign-in of its own: the one sign-in is the accounts screen's.
    expect(all.some((text) => /claude\.ai/i.test(text))).toBe(false)
    act(() => host('artifact-viewer-sign-in-button')!.props.onPress())
    expect(state.onOpenAccounts).toHaveBeenCalledTimes(1)
  })

  it('does not offer the browser on the bar while it asks for a sign-in; the browser stays a quiet second choice', () => {
    mount(needed())
    expect(host('artifact-viewer-open-browser')).toBeUndefined()
    expect(host('artifact-viewer-share')).toBeUndefined()
    act(() => host('artifact-viewer-sign-in-open-browser')!.props.onPress())
    expect(outside).toHaveBeenCalledWith(PUBLISHED_LINK)
  })

  it('offers the accounts to pick from when it cannot tell whose the artifact is', () => {
    const state = needed({ accountId: null, label: null })
    mount(state)
    expect(texts(host('artifact-viewer-sign-in')!)).toContain(ARTIFACT_VIEWER_PICK_ACCOUNT)
    expect(host('artifact-viewer-sign-in-button')).toBeUndefined()
    act(() => host('artifact-viewer-sign-in-pick-acct-personal')!.props.onPress())
    expect(state.onPick).toHaveBeenCalledWith('acct-personal')
  })

  it('with nobody signed in to Code UI, says so and opens Anthropic accounts', () => {
    const state = needed({ accountId: null, label: null, choices: [] })
    mount(state)
    expect(texts(host('artifact-viewer-sign-in')!)).toContain(ARTIFACT_VIEWER_NO_ACCOUNT)
    act(() => host('artifact-viewer-sign-in-button')!.props.onPress())
    expect(state.onOpenAccounts).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is drawn from the %s theme', (scheme, palette) => {
    mount(needed(), scheme)
    expect(flat(host('artifact-viewer-sign-in-button')!.props.style).backgroundColor).toBe(palette.text)
    const label = host('artifact-viewer-sign-in-button')!.findAll((node) => (node.type as unknown) === 'Text')[0]!
    expect(flat(label.props.style).color).toBe(palette.bg)
    const title = renderer!.root.findAll((node) => node.props.testID === 'artifact-viewer-sign-in-title' && (node.type as unknown) === 'Text')[0]!
    expect(flat(title.props.style).color).toBe(palette.text)
    expect(flat(host('artifact-viewer')!.props.style).backgroundColor).toBe(palette.bg)
  })

  it('does not paint the schemes alike, so the pins above can tell them apart', () => {
    expect(lightColors.text).not.toBe(darkColors.text)
    expect(lightColors.bg).not.toBe(darkColors.bg)
  })
})
