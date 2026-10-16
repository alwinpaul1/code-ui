import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactViewerBridgeScript, artifactViewerDocumentStartOrigins } from './artifact-viewer-policy'

// The artifact viewer's bridge (the pane object claude.ai's artifact shell reads, and the relay for
// its `__frame_chrome_state` echoes) as a true document-start script, the way the Claude app
// 1.261013.20 registers it (fb/m22.java:547-618: androidx.webkit addDocumentStartJavaScript under
// `https://<artifact host>` only, when DOCUMENT_START_SCRIPT is supported). react-native-webview
// 13.16.2 only evaluates `injectedJavaScriptBeforeContentLoaded` from onPageStarted
// (RNCWebViewClient.java:85-90), which can run after the shell's own scripts, so the repo's patch
// adds `injectedJavaScriptBeforeContentLoadedOrigins`. The native side has no behavioural handle in
// vitest, so it is pinned by reading the code the patch adds (CLAUDE.md rule 6), never its comments.

type Listener = (event: unknown) => void

/** A window the bridge can run in: its listeners, and what it posted to the app. */
function page(options: { top?: 'self' | 'other'; bridge?: boolean } = {}) {
  const listeners: Listener[] = []
  const posted: string[] = []
  const win: Record<string | symbol, unknown> = {
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener)
  }
  if (options.bridge !== false) {
    win.ReactNativeWebView = { postMessage: (body: string) => posted.push(body) }
  }
  win.top = options.top === 'other' ? {} : win
  const run = (mode: 'light' | 'dark' = 'light') =>
    new Function('window', 'location', artifactViewerBridgeScript(mode))(win, { origin: 'https://claude.ai' })
  const deliver = (data: unknown) => listeners.forEach((listener) => listener({ source: win, origin: 'https://claude.ai', data }))
  return { win, listeners, posted, run, deliver }
}

const STATE = { __frame_chrome_state: true, state: 'title', title: 'T' }

describe('the artifact bridge, run more than once in one document', () => {
  it('installs one relay and posts each echo once when both the document-start script and the onPageStarted fallback ran', () => {
    const tab = page()
    tab.run()
    tab.run()
    expect(tab.listeners).toHaveLength(1)
    tab.deliver(STATE)
    expect(tab.posted).toEqual([JSON.stringify(STATE)])
    expect(tab.win.claudeDesktopArtifactPane).toEqual({ embedded: true, mode: 'light', chrome: 'none', hostcaps: 'comment-mode' })
  })

  it('still states the pane on every run, so the last scheme handed in is the one the shell reads', () => {
    const tab = page()
    tab.run('light')
    tab.run('dark')
    expect(tab.win.claudeDesktopArtifactPane).toMatchObject({ mode: 'dark' })
    expect(tab.listeners).toHaveLength(1)
  })

  it('does not throw on an echo when the app bridge object is not there yet, and relays once it is', () => {
    const tab = page({ bridge: false })
    tab.run()
    expect(() => tab.deliver(STATE)).not.toThrow()
    const posted: string[] = []
    tab.win.ReactNativeWebView = { postMessage: (body: string) => posted.push(body) }
    tab.deliver(STATE)
    expect(posted).toEqual([JSON.stringify(STATE)])
  })

  it('does nothing in a frame: no pane object and no relay', () => {
    const frame = page({ top: 'other' })
    frame.run()
    expect(frame.win.claudeDesktopArtifactPane).toBeUndefined()
    expect(frame.listeners).toHaveLength(0)
  })
})

describe('the origins the bridge is registered under', () => {
  it('is claude.ai alone for a claude.ai artifact, as the app registers it', () => {
    expect(artifactViewerDocumentStartOrigins('https://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6')).toEqual(['https://claude.ai'])
  })

  it("adds the artifact's own claude.ai subdomain and nothing else", () => {
    expect(artifactViewerDocumentStartOrigins('https://preview.claude.ai/code/frame/abc')).toEqual(['https://claude.ai', 'https://preview.claude.ai'])
  })

  it('never names the content frame, another site, plain http, or a URL it cannot read', () => {
    for (const raw of [
      'https://abc.frame.claudeusercontent.com/x',
      'https://claude.ai.evil.example/artifact/x',
      'http://claude.ai/artifact/x',
      'not a url',
      ''
    ]) {
      expect(artifactViewerDocumentStartOrigins(raw)).toEqual(['https://claude.ai'])
    }
  })
})

// ─── The native side, as the patch adds it ─────────────────────────────────────────────────────

const MOBILE = resolve(__dirname, '../..')
const PATCH = resolve(MOBILE, 'patches/react-native-webview@13.16.2.patch')

/** The patch's code lines for one file, without comment-only lines: the lines it adds, or with
 *  `withContext` those plus the unchanged lines around them (the file as patched, hunk by hunk). */
function addedCode(file: string, withContext = false): string {
  const text = readFileSync(PATCH, 'utf8')
  const sections = text.split(/^diff --git /m)
  const section = sections.find((part) => part.startsWith(`a/${file} `))
  expect(section, `the patch touches ${file}`).toBeDefined()
  return section!
    .split('\n')
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (withContext && line.startsWith(' ')))
    .map((line) => line.slice(1).trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    .join('\n')
}

const JAVA = 'android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java'
const IMPL = 'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt'
const NEW_MANAGER = 'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java'
const OLD_MANAGER = 'android/src/oldarch/com/reactnativecommunity/webview/RNCWebViewManager.java'
const SPEC = 'src/RNCWebViewNativeComponent.ts'

describe('the react-native-webview patch', () => {
  it('registers the before-content script with addDocumentStartJavaScript, only when the WebView has DOCUMENT_START_SCRIPT, under the given rules', () => {
    const java = addedCode(JAVA)
    expect(java).toContain('WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)')
    expect(java).toContain('documentStartScript = WebViewCompat.addDocumentStartJavaScript(this, script, rules);')
    expect(java).toContain('rules = new HashSet<>(injectedJSBeforeContentLoadedOrigins);')
    // A malformed rule throws; that must fall back, not crash the screen.
    expect(java).toMatch(/try \{\s*documentStartScript = WebViewCompat\.addDocumentStartJavaScript[\s\S]*?\} catch \(RuntimeException e\) \{/)
    // A new script or new rules take the old registration out first.
    expect(java).toMatch(/if \(documentStartScript != null\) \{\s*documentStartScript\.remove\(\);/)
  })

  it('keeps the onPageStarted path for a WebView that could not register it, and skips it for one that did', () => {
    const java = addedCode(JAVA, true)
    expect(java).toMatch(
      /public void callInjectedJavaScriptBeforeContentLoaded\(\) \{\s*if \(documentStartScript != null\) \{\s*injectJavascriptObject\(\);\s*return;\s*\}\s*if \(getSettings\(\)\.getJavaScriptEnabled\(\) &&/
    )
  })

  it('registers before the pending source loads, so the first document gets it', () => {
    const text = readFileSync(PATCH, 'utf8')
    const impl = text.split(/^diff --git /m).find((part) => part.startsWith(`a/${IMPL} `))!
    expect(impl).toMatch(/fun onAfterUpdateTransaction\(viewWrapper: RNCWebViewWrapper\) \{\n(?:\+ *\/\/.*\n)*\+ *viewWrapper\.webView\.syncDocumentStartScript\(\)\n *mPendingSource\?\.let/)
    expect(addedCode(IMPL)).toContain('viewWrapper.webView.setInjectedJavaScriptBeforeContentLoadedOrigins(origins)')
  })

  it('declares the prop to codegen and to both architectures', () => {
    expect(addedCode(SPEC)).toContain('injectedJavaScriptBeforeContentLoadedOrigins?: ReadonlyArray<string>;')
    for (const manager of [NEW_MANAGER, OLD_MANAGER]) {
      expect(addedCode(manager)).toMatch(
        /@ReactProp\(name = "injectedJavaScriptBeforeContentLoadedOrigins"\)\npublic void setInjectedJavaScriptBeforeContentLoadedOrigins\(RNCWebViewWrapper view, @Nullable ReadableArray value\) \{\nmRNCWebViewManagerImpl\.setInjectedJavaScriptBeforeContentLoadedOrigins\(view, value\);/
      )
    }
  })

  it('is the patch the lockfile pins, so a frozen install applies it', () => {
    const hash = createHash('sha256').update(readFileSync(PATCH)).digest('hex')
    const lock = readFileSync(resolve(MOBILE, 'pnpm-lock.yaml'), 'utf8')
    expect(lock).toContain(`react-native-webview@13.16.2: ${hash}`)
    const pinned = [...lock.matchAll(/react-native-webview(?:@|: )13\.16\.2\(patch_hash=([0-9a-f]{64})\)/g)].map((match) => match[1])
    expect(pinned.length).toBeGreaterThan(0)
    expect(new Set(pinned)).toEqual(new Set([hash]))
  })
})
