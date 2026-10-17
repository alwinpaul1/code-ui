import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// How an artifact reaches the viewer: openClaudeArtifact pushes the `/artifact` route
// (open-claude-artifact.ts), and that route loads only a claude.ai artifact link (app/artifact.tsx),
// asks first when the link came from another app, and frames the viewer as the Claude app does: a
// side sheet over the dimmed screen on a large window, the whole screen below that.

const win = vi.hoisted(() => ({ width: 412, height: 915 }))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: win.width, height: win.height, scale: 1, fontScale: 1 })
}))

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(() => true),
  params: {} as Record<string, string | undefined>
}))
vi.mock('expo-router', () => ({
  router: { push: nav.push },
  useRouter: () => ({ back: nav.back, replace: nav.replace, canGoBack: nav.canGoBack }),
  useLocalSearchParams: () => nav.params
}))
const external = vi.hoisted(() => vi.fn())
vi.mock('../platform/external-link', () => ({ openExternalLink: external }))
vi.mock('./MobileArtifactViewer', () => ({
  MobileArtifactViewer: (props: { url: string; title: string | null }) => createElement('Viewer', props)
}))
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: (props: Record<string, unknown>) => createElement('ConfirmModal', props)
}))
const ownership = vi.hoisted(() => ({ own: false, asked: [] as string[] }))
vi.mock('./use-artifact-viewer-ownership', () => ({
  useArtifactViewerOwnsArtifact: (uuid: string) => {
    ownership.asked.push(uuid)
    return ownership.own
  }
}))

const viewerSession = vi.hoisted(() => ({
  requested: [] as (string | null)[],
  session: { kind: 'ready', accountId: null } as Record<string, unknown>,
  choose: vi.fn()
}))
vi.mock('./use-artifact-viewer-session', () => ({
  useArtifactViewerSession: (requested: string | null) => {
    viewerSession.requested.push(requested)
    return { session: viewerSession.session, choose: viewerSession.choose }
  }
}))
const accountsScreen = vi.hoisted(() => vi.fn())
vi.mock('./open-anthropic-accounts', () => ({ openAnthropicAccounts: accountsScreen }))

const shortcutKey = vi.hoisted(() => ({ good: 'key-1', checked: [] as (string | undefined)[], fail: false }))
vi.mock('./claude-artifact-shortcut-key', () => ({
  isArtifactShortcutKey: async (k: string | undefined) => {
    shortcutKey.checked.push(k)
    if (shortcutKey.fail) {
      throw new Error('boom')
    }
    return k === shortcutKey.good
  }
}))

import ArtifactViewerRoute from '../../app/artifact'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { PUBLISHED_LINK, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'
import { openClaudeArtifact } from './open-claude-artifact'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
  // clearAllMocks keeps a mockReturnValue: the close-to-home case would leave Back unavailable.
  nav.canGoBack.mockReturnValue(true)
  nav.params = {}
  win.width = 412
  win.height = 915
  ownership.own = false
  ownership.asked.length = 0
  shortcutKey.checked.length = 0
  shortcutKey.fail = false
  viewerSession.requested.length = 0
  viewerSession.session = { kind: 'ready', accountId: null }
})

function mountRoute(scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ArtifactViewerRoute />
      </ThemeProvider>
    )
  })
}
async function mountRouteSettled() {
  mountRoute()
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const viewers = () => renderer!.root.findAll((node) => (node.type as unknown) === 'Viewer')
const hostById = (id: string) => renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const dialog = () => renderer!.root.findAll((node) => (node.type as unknown) === 'ConfirmModal')[0]
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}

describe('opening an artifact', () => {
  it('pushes the viewer with the link and the title it is known by', async () => {
    openClaudeArtifact({ url: PUBLISHED_LINK, title: '  Code UI Artifact Check ' })
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalled())
    expect(nav.push).toHaveBeenCalledWith({ pathname: '/artifact', params: { url: PUBLISHED_LINK, title: 'Code UI Artifact Check' } })
  })

  it('opens an artifact signed in as the account that owns it: the opener names the account to the route', async () => {
    openClaudeArtifact({ url: PUBLISHED_LINK, title: 'Board', accountId: 'acct-work' })
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalled())
    expect(nav.push).toHaveBeenCalledWith({ pathname: '/artifact', params: { url: PUBLISHED_LINK, title: 'Board', account: 'acct-work' } })
  })

  it('pushes no title when none is known', async () => {
    openClaudeArtifact({ url: PUBLISHED_LINK, title: null })
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalled())
    expect(nav.push).toHaveBeenCalledWith({ pathname: '/artifact', params: { url: PUBLISHED_LINK } })
  })

  it('shows the viewer for a claude.ai artifact link', () => {
    nav.params = { url: PUBLISHED_LINK, title: 'Code UI Artifact Check' }
    act(() => {
      renderer = create(<ArtifactViewerRoute />)
    })
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Viewer').props).toMatchObject({ url: PUBLISHED_LINK, title: 'Code UI Artifact Check' })
    expect(nav.back).not.toHaveBeenCalled()
  })

  it('hands any other address to the browser and closes, loading nothing', () => {
    nav.params = { url: 'https://evil.example/page' }
    act(() => {
      renderer = create(<ArtifactViewerRoute />)
    })
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Viewer')).toHaveLength(0)
    expect(external).toHaveBeenCalledWith('https://evil.example/page')
    expect(nav.back).toHaveBeenCalledTimes(1)
  })

  it('forwards nothing but a web link it was handed by a deep link', () => {
    for (const url of ['intent://scan#Intent;scheme=zxing;end', 'file:///sdcard/a.html', 'javascript:alert(1)', 'codeui://pair']) {
      nav.params = { url }
      act(() => {
        renderer = create(<ArtifactViewerRoute />)
      })
      act(() => renderer?.unmount())
      renderer = null
    }
    expect(external).not.toHaveBeenCalled()
  })

  it('closes to home with no address and nothing to go back to', () => {
    nav.canGoBack.mockReturnValue(false)
    act(() => {
      renderer = create(<ArtifactViewerRoute />)
    })
    expect(external).not.toHaveBeenCalled()
    expect(nav.replace).toHaveBeenCalledWith('/')
  })
})

describe('the viewer route', () => {
  it("hands the viewer the artifact's uuid and whether it is the user's own", () => {
    ownership.own = true
    nav.params = { url: PUBLISHED_LINK }
    mountRoute()
    expect(viewers()[0]!.props).toMatchObject({ url: PUBLISHED_LINK, uuid: PUBLISHED_UUID, own: true, title: null })
    expect(ownership.asked).toContain(PUBLISHED_UUID)
  })

  it('opens an artifact signed in as the account that owns it: the route asks for that account’s session, and none for a deep link', () => {
    nav.params = { url: PUBLISHED_LINK, account: 'acct-work' }
    mountRoute()
    expect(viewerSession.requested.at(-1)).toBe('acct-work')
    act(() => renderer?.unmount())
    nav.params = { url: PUBLISHED_LINK, external: '1' }
    mountRoute()
    expect(viewerSession.requested.at(-1)).toBeNull()
  })

  it('holds the page while the session is written, and turns a missing one into the viewer’s own sign-in state', () => {
    viewerSession.session = { kind: 'checking' }
    nav.params = { url: PUBLISHED_LINK, account: 'acct-work' }
    mountRoute()
    expect(viewers()[0]!.props.signIn).toEqual({ kind: 'checking' })
    act(() => renderer?.unmount())
    viewerSession.session = { kind: 'needed', accountId: 'acct-work', label: 'NexDash', choices: [] }
    mountRoute()
    const signIn = viewers()[0]!.props.signIn
    expect(signIn).toMatchObject({ kind: 'needed', accountId: 'acct-work', label: 'NexDash' })
    signIn.onOpenAccounts()
    expect(accountsScreen).toHaveBeenCalledTimes(1)
    act(() => renderer?.unmount())
    viewerSession.session = { kind: 'ready', accountId: 'acct-work' }
    mountRoute()
    expect(viewers()[0]!.props.signIn).toBeNull()
  })

  it('opens a link from inside the app at once, with no question', () => {
    nav.params = { url: PUBLISHED_LINK }
    mountRoute()
    expect(viewers()).toHaveLength(1)
    expect(dialog()).toBeUndefined()
  })

  it('asks before opening a link another app sent, naming where it goes, and loads nothing until Open', () => {
    nav.params = { url: `${PUBLISHED_LINK}?sk=secret-share-key`, external: '1' }
    mountRoute()
    expect(viewers()).toHaveLength(0)
    expect(dialog()!.props).toMatchObject({
      visible: true,
      title: 'Open this artifact?',
      message: 'This link goes to:\nclaude.ai/artifact/8JHvPGXwg2SLbchagvbYU6',
      cancelLabel: 'Cancel',
      confirmLabel: 'Open'
    })
    // ConfirmModal calls onConfirm, then onCancel to close itself: that must not close the viewer.
    act(() => {
      dialog()!.props.onConfirm()
      dialog()!.props.onCancel()
    })
    expect(viewers()).toHaveLength(1)
    expect(viewers()[0]!.props.url).toBe(`${PUBLISHED_LINK}?sk=secret-share-key`)
    expect(dialog()!.props.visible).toBe(false)
    expect(nav.back).not.toHaveBeenCalled()
  })

  // Review 2026-10-16: an app-scheme link is always marked external (claude-artifact-native-intent.ts);
  // only the key Code UI's own shortcut carries lets it open at once, as the Claude app's does.
  it("opens Code UI's own home-screen shortcut at once, with no question", async () => {
    nav.params = { url: PUBLISHED_LINK, title: 'Board', external: '1', k: 'key-1' }
    await mountRouteSettled()
    expect(shortcutKey.checked).toEqual(['key-1'])
    expect(viewers()).toHaveLength(1)
    expect(dialog()).toBeUndefined()
  })

  it('shows nothing, neither the page nor the question, while the key is being checked', () => {
    nav.params = { url: PUBLISHED_LINK, external: '1', k: 'key-1' }
    mountRoute()
    expect(viewers()).toHaveLength(0)
    expect(dialog()?.props.visible ?? false).toBe(false)
  })

  for (const [name, k, fail] of [
    ['a wrong key', 'key-2', false],
    ['an empty key', '', false],
    ['a key the keystore could not check', 'key-1', true]
  ] as const) {
    it(`asks before opening a scheme link with ${name}`, async () => {
      shortcutKey.fail = fail
      nav.params = { url: PUBLISHED_LINK, external: '1', k }
      await mountRouteSettled()
      expect(viewers()).toHaveLength(0)
      expect(dialog()!.props.visible).toBe(true)
    })
  }

  it('closes the viewer, loading nothing, when the user cancels a link another app sent', () => {
    nav.params = { url: PUBLISHED_LINK, external: '1' }
    mountRoute()
    act(() => dialog()!.props.onCancel())
    expect(nav.back).toHaveBeenCalledTimes(1)
    expect(viewers()).toHaveLength(0)
    expect(external).not.toHaveBeenCalled()
  })

  it('still refuses a non-artifact address another app sent, without asking', () => {
    nav.params = { url: 'https://evil.example/page', external: '1' }
    mountRoute()
    expect(dialog()).toBeUndefined()
    expect(viewers()).toHaveLength(0)
    expect(nav.back).toHaveBeenCalledTimes(1)
  })

  for (const [name, width, height] of [
    ['a phone', 412, 915],
    ['a window just short of the width', 839, 1000],
    ['a wide window just short of the height', 1280, 479]
  ] as const) {
    it(`fills the screen on ${name}`, () => {
      win.width = width
      win.height = height
      nav.params = { url: PUBLISHED_LINK }
      mountRoute()
      expect(hostById('artifact-viewer-panel')).toBeUndefined()
      expect(hostById('artifact-viewer-scrim')).toBeUndefined()
      expect(flat(hostById('artifact-viewer-frame')!.props.style)).toMatchObject({ flex: 1 })
      expect(viewers()).toHaveLength(1)
    })
  }

  for (const [name, width, height] of [
    ['a window exactly at the breakpoint', 840, 480],
    ['a tablet in landscape', 1280, 800]
  ] as const) {
    it(`shows a 412 dp side sheet at the end, over the dimmed screen, on ${name}, and a tap on the dim closes it`, () => {
      win.width = width
      win.height = height
      nav.params = { url: PUBLISHED_LINK }
      mountRoute()
      const frame = hostById('artifact-viewer-frame')!
      expect(flat(frame.props.style)).toMatchObject({ flex: 1, flexDirection: 'row' })
      // The dim first, the sheet after it: the sheet sits at the end edge.
      const order = frame.children.map((child) => (typeof child === 'string' ? child : child.props.testID))
      expect(order).toEqual(['artifact-viewer-scrim', 'artifact-viewer-panel'])
      expect(flat(hostById('artifact-viewer-panel')!.props.style).width).toBe(412)
      expect(hostById('artifact-viewer-panel')!.findAll((node) => (node.type as unknown) === 'Viewer')).toHaveLength(1)
      act(() => hostById('artifact-viewer-scrim')!.props.onPress())
      expect(nav.back).toHaveBeenCalledTimes(1)
    })
  }
})

describe.each(['light', 'dark'] as const)('the viewer frame in %s mode', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors
  it('paints the full-screen frame in the scheme background', () => {
    nav.params = { url: PUBLISHED_LINK }
    mountRoute(scheme)
    expect(flat(hostById('artifact-viewer-frame')!.props.style).backgroundColor).toBe(colors.bg)
  })

  it("dims the screen behind the side sheet with the scheme's scrim and paints the sheet in its background", () => {
    win.width = 1280
    win.height = 800
    nav.params = { url: PUBLISHED_LINK }
    mountRoute(scheme)
    expect(flat(hostById('artifact-viewer-scrim')!.props.style).backgroundColor).toBe(colors.sheetScrim)
    expect(flat(hostById('artifact-viewer-panel')!.props.style).backgroundColor).toBe(colors.bg)
  })
})
