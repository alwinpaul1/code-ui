import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

/**
 * One sign-in for both halves of an account (user, 2026-10-17: "if I log in from Anthropic
 * accounts, get all the things from there — why sign in again to see artifacts"). The OAuth
 * authorize page runs in this screen's WebView; its redirect to the code page is stopped and the
 * code exchanged as a pasted one is; the claude.ai session the login left in the jar is then
 * captured for the account the code signed in. The native module is a fake with a cookie jar.
 */

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }))
vi.mock('react-native-webview', async () => {
  const React = await import('react')
  return { WebView: (props: Record<string, unknown>) => React.createElement('WebView', props) }
})

const CALLBACK = 'https://platform.claude.com/oauth/code/callback?code=the-code&state=the-state'
const auth = vi.hoisted(() => ({
  accounts: [] as { id: string; organizationUuid: string | null; organizationName: string | null; credential: { accessToken: string } }[],
  prepareLogin: vi.fn(async () => ({ url: 'https://claude.com/cai/oauth/authorize?code=true&state=the-state', codeVerifier: 'verifier' })),
  exchangeCode: vi.fn(async (_pasted: string, _verifier: string) => ({ accessToken: 'tok-work', refreshToken: 'r', expiresAt: 0 }))
}))
vi.mock('../dictation/anthropic-auth-store', () => ({
  accountLabel: (account: { organizationName: string | null }, index: number) => account.organizationName ?? `Account ${index + 1}`,
  // The real parser: what is pinned is that the redirect the page makes is the one taken.
  codeFromCallbackUrl: (address: string) => {
    const url = new URL(address)
    return url.origin + url.pathname === 'https://platform.claude.com/oauth/code/callback' && url.searchParams.get('code')
      ? `${url.searchParams.get('code')}#${url.searchParams.get('state')}`
      : null
  },
  exchangeCode: auth.exchangeCode,
  listAccounts: async () => auth.accounts,
  prepareLogin: auth.prepareLogin
}))
const jar = vi.hoisted(() => ({ signedIn: false, org: null as string | null, stored: [] as string[], calls: [] as string[] }))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    peekClaudeSession: async () => ({ signedIn: jar.signedIn, org: jar.org }),
    captureClaudeSession: async (accountId: string, expectedOrg: string) => {
      const stored = jar.signedIn && jar.org === expectedOrg
      if (stored) {
        jar.stored.push(accountId)
      }
      return { org: jar.org, stored }
    },
    clearClaudeCookies: async () => {
      jar.calls.push('clear-cookies')
      jar.signedIn = false
      jar.org = null
    }
  })
}))

import { ThemeProvider } from '../theme/theme-context'
import { READY_FALLBACK_MS } from './artifact-viewer-ready'
import { GOOGLE_SIGN_IN_USER_AGENT, ANTHROPIC_SIGN_IN_UNKNOWN_ORG, AnthropicSignInScreen, CLAUDE_HOME_URL } from './AnthropicSignInScreen'

const PERSONAL = { id: 'acct-personal', organizationUuid: 'org-personal', organizationName: 'Account 1', credential: { accessToken: 'tok-personal' } }
const WORK = { id: 'acct-work', organizationUuid: 'org-work', organizationName: 'NexDash', credential: { accessToken: 'tok-work' } }

let renderer: ReactTestRenderer | null = null
const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
    }
  })
async function mount(onDone = vi.fn(), scheme: 'light' | 'dark' = 'light') {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <AnthropicSignInScreen onDone={onDone} />
      </ThemeProvider>
    )
  })
  await settle()
  return onDone
}
const webview = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'WebView')
const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
/** claude.ai's login finished: the jar holds a session on `org`, and a page loaded. */
async function claudeSignedIn(org: string) {
  jar.signedIn = true
  jar.org = org
  await act(async () => webview().props.onLoadEnd({ nativeEvent: {} }))
  await settle()
}

beforeEach(() => {
  auth.accounts = [PERSONAL]
  auth.exchangeCode.mockClear()
  auth.prepareLogin.mockClear()
  jar.signedIn = false
  jar.org = null
  jar.stored = []
  jar.calls = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a new sign-in', () => {
  it('runs the OAuth page in the app, from a jar with no claude.ai session in it', async () => {
    jar.signedIn = true
    jar.org = 'org-personal'
    await mount()
    expect(jar.calls).toEqual(['clear-cookies'])
    expect(webview().props.source).toEqual({ uri: 'https://claude.com/cai/oauth/authorize?code=true&state=the-state' })
    expect(webview().props.sharedCookiesEnabled).toBe(true)
  })

  it('stops at the code page and exchanges its code as a pasted one, with nothing copied by hand', async () => {
    await mount()
    let allowed: boolean | undefined
    await act(async () => {
      allowed = webview().props.onShouldStartLoadWithRequest({ url: CALLBACK, isTopFrame: true })
    })
    await settle()
    expect(allowed).toBe(false)
    expect(auth.exchangeCode).toHaveBeenCalledTimes(1)
    expect(auth.exchangeCode).toHaveBeenCalledWith('the-code#the-state', 'verifier')
    // The same redirect seen again (a second callback for one navigation) is not exchanged twice.
    await act(async () => webview().props.onNavigationStateChange({ url: CALLBACK }))
    expect(auth.exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('one sign-in also keeps the claude.ai session, for the account the code signed in', async () => {
    auth.exchangeCode.mockImplementationOnce(async () => {
      auth.accounts = [PERSONAL, WORK]
      return { accessToken: 'tok-work', refreshToken: 'r', expiresAt: 0 }
    })
    const onDone = await mount()
    await act(async () => webview().props.onShouldStartLoadWithRequest({ url: CALLBACK, isTopFrame: true }))
    await settle()
    expect(webview().props.source).toEqual({ uri: CLAUDE_HOME_URL })
    await claudeSignedIn('org-work')
    expect(jar.stored).toEqual(['acct-work'])
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('does not capture before the code says whose sign-in it is', async () => {
    await mount()
    await claudeSignedIn('org-personal')
    expect(jar.stored).toEqual([])
  })

  it('lets other pages load in it, and refuses an app link it has nowhere to send', async () => {
    await mount()
    expect(webview().props.onShouldStartLoadWithRequest({ url: 'https://claude.ai/login?returnTo=x', isTopFrame: true })).toBe(true)
    expect(webview().props.onShouldStartLoadWithRequest({ url: 'intent://accounts.google.com#Intent;end', isTopFrame: true })).toBe(false)
    expect(auth.exchangeCode).not.toHaveBeenCalled()
  })

  it('says what the server refused, and offers to try again', async () => {
    auth.exchangeCode.mockRejectedValueOnce(new Error('Token exchange failed (400): bad code'))
    await mount()
    await act(async () => webview().props.onShouldStartLoadWithRequest({ url: CALLBACK, isTopFrame: true }))
    await settle()
    expect(texts(host('anthropic-sign-in-message')!)).toContain('Token exchange failed (400): bad code')
    expect(host('anthropic-sign-in-retry')).toBeDefined()
  })

  it('draws the sign-in page with no footer text under it', async () => {
    // The user, 2026-10-17: "remove this text and remove that text footer" (the email-code hint).
    await mount()
    expect(host('anthropic-sign-in-hint')).toBeUndefined()
    expect(texts(renderer!.root)).toEqual(['Sign in to Anthropic'])
  })
})

/**
 * The user, 2026-10-17, with a screenshot of a blank Chrome tab on accounts.google.com: "when i do
 * continue with google with signing in claude its shows this fix this", then "make somehow login
 * in the codeui app — see how Orca does that". claude.ai's Continue with Google opens Google in a
 * popup; upstream gave a popup with no onOpenWindow a bare WebView, which passed it to Chrome cut
 * off from its opener. Orca 1.4.229 sends Google's sign-in pages as Firefox with no client hints.
 */
describe('Continue with Google', () => {
  const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai'

  it('leaves the popup to the native side, which keeps Google in the app instead of a blank Chrome tab', async () => {
    await mount()
    // An onOpenWindow handler would take the popup away from RNCGoogleSignInPopup.
    expect(webview().props.onOpenWindow).toBeUndefined()
  })

  it('reloads a page that moves to Google as Firefox, the way Orca sends Google its sign-in', async () => {
    await mount()
    expect(webview().props.userAgent).toBeUndefined()
    let allowed: boolean | undefined
    await act(async () => {
      allowed = webview().props.onShouldStartLoadWithRequest({ url: GOOGLE, isTopFrame: true })
    })
    expect(allowed).toBe(false)
    expect(webview().props.userAgent).toBe(GOOGLE_SIGN_IN_USER_AGENT)
    expect(webview().props.source).toEqual({ uri: GOOGLE })
    // Sent as Firefox now: the reload itself goes through.
    expect(webview().props.onShouldStartLoadWithRequest({ url: GOOGLE, isTopFrame: true })).toBe(true)
    expect(webview().props.userAgent).toBe(GOOGLE_SIGN_IN_USER_AGENT)
  })

  it("lets Google's answer through as it is, then sends claude.ai as the WebView again, as Orca does", async () => {
    await mount()
    await act(async () => webview().props.onShouldStartLoadWithRequest({ url: GOOGLE, isTopFrame: true }))
    let allowed: boolean | undefined
    await act(async () => {
      allowed = webview().props.onShouldStartLoadWithRequest({ url: 'https://claude.ai/login/google-callback', isTopFrame: true })
    })
    // Not cancelled and reissued: Google's answer can be a form POST.
    expect(allowed).toBe(true)
    expect(webview().props.source).toEqual({ uri: GOOGLE })
    expect(webview().props.userAgent).toBeUndefined()
  })

  it('leaves Google frames inside a page alone, and claude.ai is sent as the WebView it is', async () => {
    await mount()
    expect(webview().props.onShouldStartLoadWithRequest({ url: 'https://accounts.google.com/gsi/iframe/select', isTopFrame: false })).toBe(true)
    expect(webview().props.onShouldStartLoadWithRequest({ url: 'https://claude.ai/login', isTopFrame: true })).toBe(true)
    expect(webview().props.userAgent).toBeUndefined()
  })

  it('a new attempt starts as the WebView again', async () => {
    await mount()
    await act(async () => webview().props.onShouldStartLoadWithRequest({ url: GOOGLE, isTopFrame: true }))
    auth.exchangeCode.mockRejectedValueOnce(new Error('bad code'))
    await act(async () => webview().props.onShouldStartLoadWithRequest({ url: CALLBACK, isTopFrame: true }))
    await settle()
    await act(async () => host('anthropic-sign-in-retry')!.props.onPress())
    await settle()
    expect(webview().props.userAgent).toBeUndefined()
  })
})

/** The WebView patch, read as code: the popup class is what keeps Google in the app. */
describe('the WebView patch keeps a Google popup in the app', () => {
  const patch = readFileSync(resolve(__dirname, '../../patches/react-native-webview@13.16.2.patch'), 'utf8')
  const added = patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  it('sends a popup with no onOpenWindow handler to RNCGoogleSignInPopup, not to a bare WebView', () => {
    expect(added).toMatch(/if \(!mHasOnOpenWindowEvent\) \{\s*RNCGoogleSignInPopup\.open\(view, resultMsg\);\s*return true;/)
  })

  it('shows only Google sign-in hosts in the app, as Firefox, without X-Requested-With, and closes with the page', () => {
    expect(added).toContain('host.equals("accounts.google.com") || host.equals("accounts.youtube.com")')
    expect(added).toContain('settings.setUserAgentString(firefoxUserAgent());')
    expect(added).toContain('Gecko/140.0 Firefox/140.0')
    expect(added).toContain('WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, Collections.<String>emptySet());')
    expect(added).toContain('public void onCloseWindow(WebView window)')
    expect(added).toContain('transport.setWebView(popup);')
  })

  it('still sends any other popup to the browser', () => {
    expect(added).toMatch(/openInBrowser\(opener, uri\);\s*opener\.post\(state::close\);\s*return true;/)
  })

  it('sizes the popup itself, since React Native ignores its requestLayout, and follows resizes', () => {
    expect(added).toMatch(/host\.addView\(popup,[\s\S]*?\);\s*fit\(\);\s*host\.addOnLayoutChangeListener\(this\);/)
    expect(added).toContain('popup.layout(0, 0, width, height);')
  })

  it('goes with the screen that opened it, and a dead renderer drops the popup, not the app', () => {
    expect(added).toMatch(/public void onViewDetachedFromWindow\(View v\) \{\s*close\(\);/)
    expect(added).toMatch(/onRenderProcessGone[\s\S]*?state\.close\(\);\s*return true;/)
  })

  it("lets a popup to the opener's own site redirect on to Google before deciding", () => {
    expect(added).toMatch(/isWeb\(uri\) && sameHost\(uri\.getHost\(\), openerHost\)\) \{\s*return false;/)
  })
})

/**
 * The user, 2026-10-17, with a screenshot of the sign-in as an empty dark page: "the page appears
 * slowly and takes too long". The page loads behind Clawd, as an artifact does, until claude.ai has
 * drawn something; a page that never says so is shown READY_FALLBACK_MS after it loaded.
 */
describe('while the sign-in page loads', () => {
  const ready = JSON.stringify({ artifactReady: true })

  it('shows Clawd over the page, which loads underneath, until the page has drawn', async () => {
    await mount()
    expect(webview()).toBeDefined()
    expect(host('anthropic-sign-in-loading')).toBeDefined()
    expect(renderer!.root.findAll((node) => node.props.testID === 'anthropic-sign-in-loading-clawd').length).toBeGreaterThan(0)
    expect(String(webview().props.injectedJavaScript)).toContain('artifactReady')
    await act(async () => webview().props.onMessage({ nativeEvent: { data: ready } }))
    expect(host('anthropic-sign-in-loading')).toBeUndefined()
  })

  it('a message that is not the ready one leaves Clawd up', async () => {
    await mount()
    await act(async () => webview().props.onMessage({ nativeEvent: { data: '{"other":1}' } }))
    expect(host('anthropic-sign-in-loading')).toBeDefined()
  })

  it('lifts anyway a while after the page loaded, so a page that never says is still shown', async () => {
    vi.useFakeTimers()
    try {
      await mount()
      await act(async () => webview().props.onLoadEnd({ nativeEvent: {} }))
      await act(async () => {
        vi.advanceTimersByTime(READY_FALLBACK_MS - 1)
      })
      expect(host('anthropic-sign-in-loading')).toBeDefined()
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(host('anthropic-sign-in-loading')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws the cover in the theme, light and dark', async () => {
    for (const [scheme, colors] of [['light', lightColors], ['dark', darkColors]] as const) {
      await mount(vi.fn(), scheme)
      expect(flat(host('anthropic-sign-in-loading')!.props.style).backgroundColor).toBe(colors.bg)
      act(() => renderer?.unmount())
      renderer = null
    }
  })
})

/** Takes the code page; the exchange signs in `account`. */
async function codeFor(account: (typeof auth.accounts)[number]) {
  auth.exchangeCode.mockImplementationOnce(async () => {
    auth.accounts = [PERSONAL, account]
    return { accessToken: account.credential.accessToken, refreshToken: 'r', expiresAt: 0 }
  })
  await act(async () => webview().props.onShouldStartLoadWithRequest({ url: CALLBACK, isTopFrame: true }))
  await settle()
}

describe('when claude.ai is not the account the code signed in', () => {
  it('refuses a claude.ai sign-in that belongs to another account, says whose it was, and starts over from a cleared jar', async () => {
    const onDone = await mount()
    await codeFor(WORK)
    await claudeSignedIn('org-personal')
    expect(jar.stored).toEqual([])
    expect(onDone).not.toHaveBeenCalled()
    expect(texts(host('anthropic-sign-in-message')!)).toContain(
      'You signed in to claude.ai as Account 1, a different account; switch accounts there and try again.'
    )
    jar.calls = []
    await act(async () => host('anthropic-sign-in-retry')!.props.onPress())
    await settle()
    expect(jar.calls).toEqual(['clear-cookies'])
    expect(auth.prepareLogin).toHaveBeenCalledTimes(2)
  })

  it("says plainly that artifacts won't open yet when the account's organization is not known", async () => {
    await mount()
    await codeFor({ ...WORK, organizationUuid: null })
    await claudeSignedIn('org-work')
    expect(jar.stored).toEqual([])
    expect(texts(host('anthropic-sign-in-message')!)).toContain(ANTHROPIC_SIGN_IN_UNKNOWN_ORG)
  })
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as const)('in %s mode', (scheme, palette) => {
  it('draws the screen and the message from the theme', async () => {
    await mount(vi.fn(), scheme)
    expect(flat(host('anthropic-sign-in')!.props.style).backgroundColor).toBe(palette.bg)
    await codeFor(WORK)
    await claudeSignedIn('org-personal')
    expect(flat(host('anthropic-sign-in-retry')!.props.style).backgroundColor).toBe(palette.text)
    const label = host('anthropic-sign-in-retry')!.findAll((node) => (node.type as unknown) === 'Text')[0]!
    expect(flat(label.props.style).color).toBe(palette.bg)
  })
})
