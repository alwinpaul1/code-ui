import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The in-app artifact viewer, after the Claude app's (1.261013.20, sq30.java): its bar (Close, the
// title, Undo/Redo, Comments, Add to home screen, Share or Open in browser), the bridge it injects
// into claude.ai's artifact shell and the echoes it reads back, the ask before a link leaves, the
// error column and Retry, which navigations stay in it, and Back.

const back = vi.hoisted(() => ({ handlers: [] as (() => boolean)[] }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      back.handlers.push(handler)
      return { remove: () => back.handlers.splice(back.handlers.indexOf(handler), 1) }
    }
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }))
const web = vi.hoisted(() => ({ goBack: vi.fn(), injectJavaScript: vi.fn() }))
vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => web)
    return React.createElement('WebView', props)
  })
  return { WebView }
})
const external = vi.hoisted(() => vi.fn())
vi.mock('../platform/external-link', () => ({ openExternalLink: external }))
// Code UI registers for claude.ai artifact links, so an artifact's own address must reach the
// browser explicitly, not through a plain open that the app itself could answer.
const outside = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./open-outside-app', () => ({ openUrlOutsideApp: outside }))
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: (props: Record<string, unknown>) => createElement('ConfirmModal', props)
}))
const shortcut = vi.hoisted(() => ({ pin: vi.fn() }))
vi.mock('./claude-artifact-shortcut', () => ({ pinClaudeArtifactShortcut: shortcut.pin }))

import { ThemeProvider } from '../theme/theme-context'
import { ARTIFACT_VIEWER_ALREADY_HOME, ARTIFACT_VIEWER_ERROR, ARTIFACT_VIEWER_HOME_FAILED, MobileArtifactViewer } from './MobileArtifactViewer'
import { PUBLISHED_LINK, PUBLISHED_TITLE, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  external.mockReset()
  outside.mockClear()
  shortcut.pin.mockReset()
  web.goBack.mockReset()
  web.injectJavaScript.mockReset()
  back.handlers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount(props: { title?: string | null; scheme?: 'light' | 'dark'; own?: boolean; onClose?: () => void } = {}) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={props.scheme ?? 'light'}>
        <MobileArtifactViewer
          url={PUBLISHED_LINK}
          uuid={PUBLISHED_UUID}
          own={props.own ?? false}
          title={props.title === undefined ? 'code-ui-artifact-check.html' : props.title}
          onClose={props.onClose ?? vi.fn()}
        />
      </ThemeProvider>
    )
  })
}
const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const webview = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'WebView')
const confirm = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'ConfirmModal')
const titleText = (): string => [host('artifact-viewer-title')!.props.children].flat().join('')
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const post = (data: unknown, url = PUBLISHED_LINK) =>
  act(() => webview().props.onMessage({ nativeEvent: { data: JSON.stringify(data), url } }))
const echo = (state: string, fields: Record<string, unknown> = {}, url = PUBLISHED_LINK) =>
  post({ __frame_chrome_state: true, state, ...fields }, url)
/** The bar's end buttons, in order, by testID. */
const barEnd = (): string[] =>
  host('artifact-viewer-actions')!.children.map((child) => (typeof child === 'string' ? child : String(child.props.testID)))
/** Which ClaudeCdsGlyph.tsx glyph (its CdsIcon name) a button draws. */
const glyphOf = (id: string): string =>
  host(id)!.findAll((node) => typeof node.type === 'function' && typeof node.props.name === 'string')[0]!.props.name as string
const loaded = () => act(() => webview().props.onLoadEnd({ nativeEvent: {} }))

describe('the artifact viewer', () => {
  it('loads the artifact with JS, storage and the shared cookies a sign-in needs', () => {
    mount()
    expect(webview().props).toMatchObject({
      source: { uri: PUBLISHED_LINK },
      javaScriptEnabled: true,
      domStorageEnabled: true,
      sharedCookiesEnabled: true,
      thirdPartyCookiesEnabled: true
    })
  })

  it('tells the shell before its scripts run that it is embedded, in the app scheme, with no bar of its own and only comment mode claimed', () => {
    mount()
    const script = webview().props.injectedJavaScriptBeforeContentLoaded as string
    expect(webview().props.injectedJavaScriptBeforeContentLoadedForMainFrameOnly).toBe(true)
    expect(script).toContain(
      'window.claudeDesktopArtifactPane = { embedded: true, mode: "light", chrome: "none", hostcaps: "comment-mode" };'
    )
    expect(script).toContain('if (!data || data.__frame_chrome_state !== true) return;')
    expect(script).toContain('const app = window.ReactNativeWebView;')
    expect(script).toContain('app.postMessage(body);')
  })

  // The Claude app registers the bridge as a true document-start script under its artifact host
  // alone (fb/m22.java:547-618). On Android the viewer asks the patched react-native-webview for the
  // same, and still hands it the script, which is what runs from onPageStarted on a WebView without
  // DOCUMENT_START_SCRIPT and on every other platform.
  it('asks for the bridge at document start on claude.ai alone, and still hands it over for a WebView that cannot do that', () => {
    mount()
    expect(webview().props.injectedJavaScriptBeforeContentLoadedOrigins).toEqual(['https://claude.ai'])
    expect(webview().props.injectedJavaScriptBeforeContentLoaded).toContain('window.claudeDesktopArtifactPane = {')
  })

  it("relays only the shell's own chrome echoes from the top frame, as the app's document-start script does", () => {
    mount()
    const script = webview().props.injectedJavaScriptBeforeContentLoaded as string
    const run = (top: 'self' | 'other') => {
      const listeners: ((event: unknown) => void)[] = []
      const posted: string[] = []
      const win: Record<string, unknown> = {
        addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener),
        ReactNativeWebView: { postMessage: (body: string) => posted.push(body) }
      }
      win.top = top === 'self' ? win : {}
      new Function('window', 'location', script)(win, { origin: 'https://claude.ai' })
      return { win, posted, deliver: (event: unknown) => listeners.forEach((listener) => listener(event)) }
    }
    const page = run('self')
    expect(page.win.claudeDesktopArtifactPane).toEqual({ embedded: true, mode: 'light', chrome: 'none', hostcaps: 'comment-mode' })
    const state = { __frame_chrome_state: true, state: 'title', title: 'T' }
    page.deliver({ source: page.win, origin: 'https://claude.ai', data: state })
    page.deliver({ source: {}, origin: 'https://claude.ai', data: state })
    page.deliver({ source: page.win, origin: 'https://evil.example', data: state })
    page.deliver({ source: page.win, origin: 'https://claude.ai', data: { state: 'title', title: 'no flag' } })
    page.deliver({ source: page.win, origin: 'https://claude.ai', data: null })
    expect(page.posted).toEqual([JSON.stringify(state)])
    // In a frame it relays nothing at all.
    const frame = run('other')
    frame.deliver({ source: frame.win, origin: 'https://claude.ai', data: state })
    expect(frame.posted).toEqual([])
  })

  it("titles itself by the shell's title echo, Artifact when that echo is blank, and before one by the page's title, the one it was opened with, else Artifact", () => {
    mount()
    expect(titleText()).toBe('code-ui-artifact-check.html')
    // The shell's own name and an address say nothing: the passed title stays.
    post({ artifactTitle: 'Claude' })
    post({ artifactTitle: PUBLISHED_LINK })
    expect(titleText()).toBe('code-ui-artifact-check.html')
    post({ artifactTitle: 'From document.title' })
    expect(titleText()).toBe('From document.title')
    echo('title', { title: PUBLISHED_TITLE })
    expect(titleText()).toBe(PUBLISHED_TITLE)
    // Once the shell has spoken, document.title no longer moves the bar.
    post({ artifactTitle: 'Later document title' })
    expect(titleText()).toBe(PUBLISHED_TITLE)
    echo('title', { title: '   ' })
    expect(titleText()).toBe('Artifact')
    act(() => renderer!.unmount())
    mount({ title: null })
    expect(titleText()).toBe('Artifact')
  })

  it('takes nothing from a page off claude.ai, an echo for another artifact, an echo kind it does not know, or a message that is not one', () => {
    mount()
    post({ artifactTitle: 'Phish' }, 'https://evil.example/')
    echo('title', { title: 'Phish' }, 'https://evil.example/')
    echo('title', { title: 'Phish' }, 'http://claude.ai/artifact/x')
    // Google's sign-in is kept in the WebView but does not title the bar.
    post({ artifactTitle: 'Sign in - Google Accounts' }, 'https://accounts.google.com/o/oauth2/auth')
    echo('chrome', { uuid: '00000000-0000-0000-0000-000000000000', chrome: { v: 1, actions: [{ id: 'undo' }] } })
    echo('chrome', { chrome: { v: 1, actions: [{ id: 'undo' }] } }, 'https://evil.example/')
    echo('comment_mode', { available: true, on: false }, 'https://x.frame.claudeusercontent.com/')
    echo('print', { title: 'nope' })
    act(() => webview().props.onMessage({ nativeEvent: { data: 'not json', url: PUBLISHED_LINK } }))
    act(() => webview().props.onMessage({ nativeEvent: { data: 'null', url: PUBLISHED_LINK } }))
    expect(titleText()).toBe('code-ui-artifact-check.html')
    expect(barEnd()).toEqual(['artifact-viewer-open-browser'])
    // The same echo naming this artifact's uuid, in any case, is taken.
    echo('chrome', { uuid: PUBLISHED_UUID.toUpperCase(), chrome: { v: 1, actions: [{ id: 'undo' }] } })
    expect(barEnd()).toEqual(['artifact-viewer-undo', 'artifact-viewer-open-browser'])
  })

  it('shows Undo and Redo only while the shell offers them, greyed and inert when it says disabled, and gives the title two lines beside them', () => {
    mount()
    expect(host('artifact-viewer-title')!.props.numberOfLines).toBe(1)
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'redo', disabled: true }, { id: 'undo' }, { id: 'comment_selection' }, { id: 'print' }, 'junk'] } })
    expect(barEnd()).toEqual(['artifact-viewer-undo', 'artifact-viewer-redo', 'artifact-viewer-open-browser'])
    expect(host('artifact-viewer-undo')!.props).toMatchObject({ accessibilityLabel: 'Undo', disabled: false })
    expect(host('artifact-viewer-redo')!.props).toMatchObject({ accessibilityLabel: 'Redo', disabled: true })
    expect(host('artifact-viewer-redo')!.props.accessibilityState).toMatchObject({ disabled: true })
    expect(host('artifact-viewer-title')!.props.numberOfLines).toBe(2)
    // Only Redo is offered: still two lines.
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'redo' }] } })
    expect(barEnd()).toEqual(['artifact-viewer-redo', 'artifact-viewer-open-browser'])
    expect(host('artifact-viewer-title')!.props.numberOfLines).toBe(2)
    // `chrome: null` and an empty list both take them away.
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: null })
    expect(barEnd()).toEqual(['artifact-viewer-open-browser'])
    expect(host('artifact-viewer-title')!.props.numberOfLines).toBe(1)
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'undo' }] } })
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [] } })
    expect(barEnd()).toEqual(['artifact-viewer-open-browser'])
  })

  it('sends Undo and Redo to the shell as its own chrome actions', () => {
    mount()
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'undo' }, { id: 'redo' }] } })
    act(() => host('artifact-viewer-undo')!.props.onPress())
    act(() => host('artifact-viewer-redo')!.props.onPress())
    expect(web.injectJavaScript.mock.calls).toEqual([
      ['window.postMessage({"__frame_chrome":true,"cmd":"action","id":"undo"}, location.origin); true;'],
      ['window.postMessage({"__frame_chrome":true,"cmd":"action","id":"redo"}, location.origin); true;']
    ])
  })

  it('forgets the undo and comment buttons of a page it has navigated away from', () => {
    mount()
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'undo' }] } })
    echo('comment_mode', { available: true, on: false })
    expect(barEnd()).toEqual(['artifact-viewer-undo', 'artifact-viewer-comments', 'artifact-viewer-open-browser'])
    act(() => webview().props.onLoadStart({ nativeEvent: { url: 'https://claude.ai/login' } }))
    expect(barEnd()).toEqual(['artifact-viewer-open-browser'])
  })

  it('offers Comments only when the shell says comments are available, and turns comment mode over with each tap', () => {
    mount()
    echo('comment_mode', { available: false, on: false })
    expect(host('artifact-viewer-comments')).toBeUndefined()
    echo('comment_mode', { available: true, on: false })
    expect(host('artifact-viewer-comments')!.props).toMatchObject({
      accessibilityLabel: 'Comments',
      accessibilityActions: [{ name: 'activate', label: 'Comment' }]
    })
    expect(glyphOf('artifact-viewer-comments')).toBe('chats')
    act(() => host('artifact-viewer-comments')!.props.onPress())
    expect(web.injectJavaScript).toHaveBeenLastCalledWith('window.postMessage({"__frame_chrome":true,"cmd":"comment_mode","on":true}, location.origin); true;')
    // The bar follows the shell's echo, not its own tap.
    expect(glyphOf('artifact-viewer-comments')).toBe('chats')
    echo('comment_mode', { available: true, on: true })
    expect(glyphOf('artifact-viewer-comments')).toBe('chatsFilled')
    expect(host('artifact-viewer-comments')!.props.accessibilityActions).toEqual([{ name: 'activate', label: 'Stop commenting' }])
    expect(host('artifact-viewer-comments')!.props.accessibilityState).toMatchObject({ selected: true })
    act(() => host('artifact-viewer-comments')!.props.onPress())
    expect(web.injectJavaScript).toHaveBeenLastCalledWith('window.postMessage({"__frame_chrome":true,"cmd":"comment_mode","on":false}, location.origin); true;')
  })

  it("offers Open in browser for someone else's artifact", () => {
    mount({ own: false })
    expect(host('artifact-viewer-share')).toBeUndefined()
    expect(host('artifact-viewer-open-browser')!.props.accessibilityLabel).toBe('Open in browser')
    expect(glyphOf('artifact-viewer-open-browser')).toBe('arrowOutSquare')
    act(() => host('artifact-viewer-open-browser')!.props.onPress())
    expect(outside).toHaveBeenCalledWith(PUBLISHED_LINK)
    expect(external).not.toHaveBeenCalled()
  })

  it("offers Share for the user's own artifact, which asks the shell to share it, and Open in browser again once the page has failed", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mount({ own: true })
    expect(host('artifact-viewer-open-browser')).toBeUndefined()
    expect(host('artifact-viewer-share')!.props.accessibilityLabel).toBe('Share')
    expect(glyphOf('artifact-viewer-share')).toBe('share')
    act(() => host('artifact-viewer-share')!.props.onPress())
    expect(web.injectJavaScript).toHaveBeenCalledWith('window.postMessage({"__frame_chrome":true,"cmd":"share"}, location.origin); true;')
    act(() => webview().props.onError({ nativeEvent: { description: 'x' } }))
    expect(host('artifact-viewer-share')).toBeUndefined()
    expect(host('artifact-viewer-open-browser')).toBeDefined()
  })

  it('lays the bar out as the app does: Close, title, then Undo, Redo, Comments, Add to home screen, Share', () => {
    mount({ own: true })
    loaded()
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'undo' }, { id: 'redo' }] } })
    echo('comment_mode', { available: true, on: false })
    expect(barEnd()).toEqual(['artifact-viewer-undo', 'artifact-viewer-redo', 'artifact-viewer-comments', 'artifact-viewer-add-home', 'artifact-viewer-share'])
    expect(flat(host('artifact-viewer-actions')!.props.style).gap).toBe(8)
    expect(host('artifact-viewer-close')!.props.accessibilityLabel).toBe('Close')
    // CdsIcon names, by wu0.java's code points: x U+E10F, arrowCounterClockwise U+E11E,
    // arrowClockwise U+E11D, chats U+E039, home U+E08A, share U+E0DA.
    expect(['artifact-viewer-close', ...barEnd()].map(glyphOf)).toEqual(['x', 'arrowCounterClockwise', 'arrowClockwise', 'chats', 'home', 'share'])
    // Every bar button is a 48 dp tap target, as the app's are.
    for (const id of ['artifact-viewer-close', ...barEnd()]) {
      expect(flat(host(id)!.props.style)).toMatchObject({ width: 48, height: 48 })
    }
  })

  it("offers Add to home screen only for the user's own artifact, and only once its page has loaded", () => {
    mount({ own: false })
    loaded()
    expect(host('artifact-viewer-add-home')).toBeUndefined()
    act(() => renderer!.unmount())
    mount({ own: true })
    expect(host('artifact-viewer-add-home')).toBeUndefined()
    loaded()
    expect(host('artifact-viewer-add-home')!.props.accessibilityLabel).toBe('Add to home screen')
    expect(glyphOf('artifact-viewer-add-home')).toBe('home')
  })

  it('adds the shortcut under the bar title, says it is adding while it waits, and takes no second tap meanwhile', async () => {
    let finish: (result: string) => void = () => undefined
    shortcut.pin.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    mount({ own: true })
    echo('title', { title: PUBLISHED_TITLE })
    loaded()
    act(() => host('artifact-viewer-add-home')!.props.onPress())
    expect(shortcut.pin).toHaveBeenCalledWith({ url: PUBLISHED_LINK, title: PUBLISHED_TITLE })
    expect(host('artifact-viewer-add-home')!.props).toMatchObject({ accessibilityLabel: 'Adding to home screen…', disabled: true })
    act(() => host('artifact-viewer-add-home')!.props.onPress())
    expect(shortcut.pin).toHaveBeenCalledTimes(1)
    await act(async () => finish('pinned'))
    expect(host('artifact-viewer-add-home')!.props.accessibilityLabel).toBe('Add to home screen')
    // A pinned shortcut is confirmed by the launcher, not by a toast.
    expect(texts(renderer!.root)).not.toContain(ARTIFACT_VIEWER_ALREADY_HOME)
    expect(texts(renderer!.root)).not.toContain(ARTIFACT_VIEWER_HOME_FAILED)
  })

  for (const [result, words] of [
    ['already', ARTIFACT_VIEWER_ALREADY_HOME],
    ['unsupported', ARTIFACT_VIEWER_HOME_FAILED],
    ['failed', ARTIFACT_VIEWER_HOME_FAILED]
  ] as const) {
    it(`says "${words}" when the launcher answers ${result}, and lets it go after a while`, async () => {
      vi.useFakeTimers()
      shortcut.pin.mockResolvedValue(result)
      mount({ own: true })
      loaded()
      await act(async () => host('artifact-viewer-add-home')!.props.onPress())
      expect(texts(renderer!.root)).toContain(words)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(texts(renderer!.root)).not.toContain(words)
    })
  }

  it("says it couldn't add to the home screen when adding throws, and says why in the log", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    shortcut.pin.mockRejectedValue(new Error('no launcher'))
    mount({ own: true })
    loaded()
    await act(async () => host('artifact-viewer-add-home')!.props.onPress())
    expect(texts(renderer!.root)).toContain(ARTIFACT_VIEWER_HOME_FAILED)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no launcher'))
    expect(host('artifact-viewer-add-home')!.props.disabled).toBeFalsy()
  })

  it('closes from the cross', () => {
    const onClose = vi.fn()
    mount({ onClose })
    act(() => host('artifact-viewer-close')!.props.onPress())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('loads with one loader, Clawd dancing over the whole page in the %s theme, and no spinner', (scheme, colors) => {
    mount({ scheme })
    const cover = host('artifact-viewer-loading')!
    expect(cover).toBeDefined()
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'ActivityIndicator')).toHaveLength(0)
    expect(cover.findAll((node) => node.props.testID === 'artifact-viewer-loading-clawd' && typeof node.type === 'string')).toHaveLength(1)
    // Opaque and over all of the page, so the shell's own spinner underneath is never seen.
    expect(flat(cover.props.style)).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg })
  })

  it("keeps Clawd over the page's own loader until the page says the artifact is drawn", () => {
    mount()
    loaded()
    expect(host('artifact-viewer-loading')).toBeDefined()
    post({ artifactReady: true })
    expect(host('artifact-viewer-loading')).toBeUndefined()
  })

  it('asks the page, from the scripts it injects, to say when nothing on it is loading any more', () => {
    mount()
    expect(String(webview().props.injectedJavaScript)).toContain('artifactReady')
    expect(String(webview().props.injectedJavaScriptBeforeContentLoaded)).toContain('__codeUiFrames')
  })

  it('takes Clawd away 8 s after the page loaded when the page never says it is drawn', () => {
    vi.useFakeTimers()
    mount()
    loaded()
    act(() => {
      vi.advanceTimersByTime(7900)
    })
    expect(host('artifact-viewer-loading')).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(host('artifact-viewer-loading')).toBeUndefined()
  })

  it('takes Clawd away as soon as a sign-in page has loaded, which has no artifact to wait for', () => {
    mount()
    act(() => webview().props.onHttpError({ nativeEvent: { statusCode: 401 } }))
    loaded()
    expect(host('artifact-viewer-loading')).toBeUndefined()
  })

  it('puts Clawd back over the next page the viewer loads', () => {
    mount()
    loaded()
    post({ artifactReady: true })
    act(() => webview().props.onLoadStart({ nativeEvent: {} }))
    expect(host('artifact-viewer-loading')).toBeDefined()
  })

  it('keeps claude.ai, its sign-in and the sign-in providers inside, and asks before sending any other page out', () => {
    mount()
    const policy = webview().props.onShouldStartLoadWithRequest as (request: { url: string; isTopFrame?: boolean }) => boolean
    for (const kept of [
      'https://claude.ai/login?returnTo=%2Fartifact%2F8JHvPGXwg2SLbchagvbYU6',
      'https://preview.claude.ai/artifact/x',
      'https://console.anthropic.com/',
      'https://accounts.google.com/o/oauth2/auth',
      'https://appleid.apple.com/auth/authorize'
    ]) {
      expect(policy({ url: kept, isTopFrame: true })).toBe(true)
    }
    expect(confirm().props.visible).toBe(false)
    for (const out of ['https://github.com/anthropics', 'http://claude.ai/', 'https://claude.ai.evil.example/']) {
      let kept: boolean | undefined
      act(() => {
        kept = policy({ url: out, isTopFrame: true })
      })
      expect(kept).toBe(false)
      expect(confirm().props).toMatchObject({
        visible: true,
        title: 'Open this website?',
        message: `This link goes to:\n${out}`,
        cancelLabel: 'Cancel',
        confirmLabel: 'Open'
      })
      act(() => confirm().props.onCancel())
      expect(confirm().props.visible).toBe(false)
    }
    // Nothing left the app: each was cancelled.
    expect(external).not.toHaveBeenCalled()
    // The page's content is a frame on its own host: frames are not policed.
    expect(policy({ url: 'https://example.claudeusercontent.com/page', isTopFrame: false })).toBe(true)
  })

  it('opens a link out in the browser once the user says Open', () => {
    mount()
    act(() => {
      webview().props.onShouldStartLoadWithRequest({ url: 'https://github.com/anthropics', isTopFrame: true })
    })
    // ConfirmModal calls onConfirm, then onCancel to close itself.
    act(() => {
      confirm().props.onConfirm()
      confirm().props.onCancel()
    })
    expect(external).toHaveBeenCalledWith('https://github.com/anthropics')
    expect(external).toHaveBeenCalledTimes(1)
    // Only an artifact's own address needs the explicit browser.
    expect(outside).not.toHaveBeenCalled()
    expect(confirm().props.visible).toBe(false)
  })

  // Review 2026-10-16: react-native-webview 13.16.2 reports every Android navigation as the top
  // frame (TopShouldStartLoadWithRequestEvent.kt:18), so the artifact's own frame host, which
  // Claude Code 2.1.301 names `<slug>.frame.claudeusercontent.com` (k7e), must be kept by host too.
  it("keeps the artifact's own content frame inside even when Android calls it the top frame", () => {
    mount()
    const policy = webview().props.onShouldStartLoadWithRequest as (request: { url: string; isTopFrame?: boolean }) => boolean
    expect(policy({ url: 'https://3b1a0ad3-2ac6-4209-b219-d64d46bfa3bf.frame.claudeusercontent.com/index.html', isTopFrame: true })).toBe(true)
    expect(policy({ url: 'https://x.frame.staging.claudeusercontent.com/', isTopFrame: true })).toBe(true)
    act(() => {
      expect(policy({ url: 'https://claudeusercontent.com.evil.example/', isTopFrame: true })).toBe(false)
    })
    act(() => {
      expect(policy({ url: 'https://evil.claudeusercontent.com/', isTopFrame: true })).toBe(false)
    })
  })

  it('loads a kept popup in place and asks before sending any other out', () => {
    mount()
    act(() => webview().props.onOpenWindow({ nativeEvent: { targetUrl: 'https://accounts.google.com/o/oauth2/auth' } }))
    expect(web.injectJavaScript).toHaveBeenCalledWith('window.location.assign("https://accounts.google.com/o/oauth2/auth");true;')
    expect(confirm().props.visible).toBe(false)
    act(() => webview().props.onOpenWindow({ nativeEvent: { targetUrl: 'https://github.com/' } }))
    expect(external).not.toHaveBeenCalled()
    expect(confirm().props).toMatchObject({ visible: true, message: 'This link goes to:\nhttps://github.com/' })
    act(() => confirm().props.onConfirm())
    expect(external).toHaveBeenCalledWith('https://github.com/')
  })

  // Review 2026-10-16: the content-frame host is kept for frame loads only. A popup to it replaced
  // the claude.ai page under our own bar, still titled as the artifact the user opened.
  for (const target of [
    'https://attacker-slug.frame.claudeusercontent.com/fake-login.html',
    'https://attacker-slug.frame.staging.claudeusercontent.com/'
  ]) {
    it(`asks before a popup to another artifact's content frame takes the page: ${target}`, () => {
      mount()
      act(() => webview().props.onOpenWindow({ nativeEvent: { targetUrl: target } }))
      expect(web.injectJavaScript).not.toHaveBeenCalled()
      expect(confirm().props).toMatchObject({ visible: true, message: `This link goes to:\n${target}` })
    })
  }

  it('does nothing for a blank popup: no page replaced, no question', () => {
    mount()
    act(() => webview().props.onOpenWindow({ nativeEvent: { targetUrl: 'about:blank' } }))
    expect(web.injectJavaScript).not.toHaveBeenCalled()
    expect(confirm().props.visible).toBe(false)
  })

  it('still loads a claude.ai popup in place', () => {
    mount()
    act(() => webview().props.onOpenWindow({ nativeEvent: { targetUrl: 'https://claude.ai/login' } }))
    expect(web.injectJavaScript).toHaveBeenCalledWith('window.location.assign("https://claude.ai/login");true;')
  })

  for (const [name, fail] of [
    ['the page cannot be reached', (w: ReactTestInstance) => w.props.onError({ nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' } })],
    ['the page answers 500', (w: ReactTestInstance) => w.props.onHttpError({ nativeEvent: { statusCode: 500 } })]
  ] as const) {
    it(`shows the error column when ${name}, and Retry loads a fresh page`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mount()
      const first = webview()
      act(() => fail(first))
      expect(renderer!.root.findAll((node) => (node.type as unknown) === 'WebView')).toHaveLength(0)
      expect(texts(host('artifact-viewer-error')!)).toEqual([ARTIFACT_VIEWER_ERROR, 'Retry', 'Open in browser'])
      expect(flat(host('artifact-viewer-error')!.props.style)).toMatchObject({ padding: 24, alignItems: 'center', justifyContent: 'center' })
      expect(warn).toHaveBeenCalled()
      act(() => host('artifact-viewer-error-open-browser')!.props.onPress())
      expect(outside).toHaveBeenCalledWith(PUBLISHED_LINK)
      expect(external).not.toHaveBeenCalled()
      act(() => host('artifact-viewer-retry')!.props.onPress())
      expect(host('artifact-viewer-error')).toBeUndefined()
      expect(webview()).not.toBe(first)
      expect(host('artifact-viewer-loading')).toBeDefined()
    })
  }

  it('takes Add to home screen away when the page fails, and gives it back only after Retry has loaded it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mount({ own: true })
    loaded()
    expect(host('artifact-viewer-add-home')).toBeDefined()
    act(() => webview().props.onError({ nativeEvent: { description: 'x' } }))
    expect(host('artifact-viewer-add-home')).toBeUndefined()
    act(() => host('artifact-viewer-retry')!.props.onPress())
    expect(host('artifact-viewer-add-home')).toBeUndefined()
    loaded()
    expect(host('artifact-viewer-add-home')).toBeDefined()
  })

  it('keeps the page when it answers 401 or 403, which is the shell asking for a sign-in', () => {
    mount()
    act(() => webview().props.onHttpError({ nativeEvent: { statusCode: 403 } }))
    expect(host('artifact-viewer-error')).toBeUndefined()
    expect(webview()).toBeDefined()
  })

  it('steps back inside the page with Back, and leaves Back to close the viewer when it cannot', () => {
    mount()
    expect(back.handlers).toHaveLength(0)
    act(() => webview().props.onNavigationStateChange({ canGoBack: true, url: 'https://claude.ai/login' }))
    expect(back.handlers).toHaveLength(1)
    expect(back.handlers[0]!()).toBe(true)
    expect(web.goBack).toHaveBeenCalledTimes(1)
    act(() => webview().props.onNavigationStateChange({ canGoBack: false, url: PUBLISHED_LINK }))
    expect(back.handlers).toHaveLength(0)
  })
})

describe.each(['light', 'dark'] as const)('the viewer in %s mode', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors
  it('draws its bar, title and page background in the scheme', () => {
    mount({ scheme })
    expect(flat(host('artifact-viewer')!.props.style).backgroundColor).toBe(colors.bg)
    expect(flat(host('artifact-viewer-bar')!.props.style)).toMatchObject({ backgroundColor: colors.bg, borderBottomColor: colors.border, paddingTop: 24 })
    expect(flat(host('artifact-viewer-title')!.props.style).color).toBe(colors.text)
    expect(flat(webview().props.style).backgroundColor).toBe(colors.bg)
  })

  it('tells the shell the scheme it is drawn in', () => {
    mount({ scheme })
    expect(webview().props.injectedJavaScriptBeforeContentLoaded).toContain(`mode: "${scheme}"`)
  })

  it('draws the bar glyphs in the scheme, a disabled one in the secondary ink', () => {
    mount({ scheme, own: true })
    loaded()
    echo('chrome', { uuid: PUBLISHED_UUID, chrome: { v: 1, actions: [{ id: 'undo' }, { id: 'redo', disabled: true }] } })
    const fill = (id: string) => host(id)!.findAll((node) => (node.type as unknown) === 'Path')[0]!.props.fill
    for (const id of ['artifact-viewer-close', 'artifact-viewer-undo', 'artifact-viewer-add-home', 'artifact-viewer-share']) {
      expect(fill(id)).toBe(colors.text)
    }
    expect(fill('artifact-viewer-redo')).toBe(colors.textSecondary)
  })

  it('draws the error column in the scheme', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mount({ scheme })
    act(() => webview().props.onError({ nativeEvent: { description: 'x' } }))
    const [words] = host('artifact-viewer-error')!.findAll((node) => (node.type as unknown) === 'Text')
    expect(flat(words!.props.style).color).toBe(colors.text)
    expect(flat(host('artifact-viewer-retry')!.props.style).backgroundColor).toBe(colors.text)
  })

  it('draws the add-to-home toast in the scheme', async () => {
    shortcut.pin.mockResolvedValue('already')
    mount({ scheme, own: true })
    loaded()
    await act(async () => host('artifact-viewer-add-home')!.props.onPress())
    const toastBox = renderer!.root.findAll(
      (node) => (node.type as unknown) === 'View' && flat(node.props.style).backgroundColor === colors.bgRaised
    )
    expect(toastBox).toHaveLength(1)
  })
})
