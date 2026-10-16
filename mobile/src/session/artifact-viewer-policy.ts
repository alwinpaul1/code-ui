/**
 * What the artifact viewer keeps in its own WebView, and what it reads as the page's title.
 *
 * Kept: claude.ai and its subdomains (the artifact shell, its login), anthropic.com (the account
 * pages a sign-in can pass through), and the two sign-in providers claude.ai's login offers,
 * Google's and Apple's. Everything else a top frame is sent to is a link out of the page and opens
 * in the browser, as the Claude app's viewer does (sq30.java). `about:blank` is where a WebView
 * starts and is kept too.
 */
const KEPT_HOSTS = ['claude.ai', 'anthropic.com']
const KEPT_EXACT = new Set(['accounts.google.com', 'appleid.apple.com'])
/** The artifact's own content frame, `<slug>.frame[.staging].claudeusercontent.com` (Claude Code
 *  2.1.301 `k7e`). react-native-webview 13.16.2 reports every Android navigation as the top frame,
 *  so a frame cannot be told apart by `isTopFrame` there and is kept by its host (review
 *  2026-10-16). */
const CONTENT_FRAME_HOST = /^[a-z0-9-]+\.frame\.(?:staging\.)?claudeusercontent\.com$/

export function artifactViewerKeepsNavigation(raw: string): boolean {
  if (raw === 'about:blank') {
    return true
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') {
    return false
  }
  const host = url.hostname.toLowerCase()
  return KEPT_EXACT.has(host) || CONTENT_FRAME_HOST.test(host) || KEPT_HOSTS.some((kept) => host === kept || host.endsWith(`.${kept}`))
}

/**
 * Whether a popup (`window.open`, a `target="_blank"` link) may load in the viewer in place of the
 * claude.ai page. The same hosts as artifactViewerKeepsNavigation but never the content frame: that
 * host is kept only so the shell's own iframe loads, and a popup to it would put some other
 * artifact's page under the bar, still titled as the one the user opened (review 2026-10-16).
 */
export function artifactViewerKeepsPopup(raw: string): boolean {
  if (!artifactViewerKeepsNavigation(raw) || raw === 'about:blank') {
    return false
  }
  return !CONTENT_FRAME_HOST.test(new URL(raw).hostname.toLowerCase())
}

/** The longest title the bar is handed; the bar cuts it to one line anyway. */
const TITLE_MAX = 200

/** Whether a message came from a claude.ai page over https: the artifact shell, the only page whose
 *  echoes and title the bar takes. Google's and Apple's sign-in pages are kept in the WebView but
 *  say nothing to the bar. */
export function artifactViewerTrustsOrigin(fromUrl: string | undefined): boolean {
  if (fromUrl === undefined) {
    return false
  }
  let url: URL
  try {
    url = new URL(fromUrl)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return url.protocol === 'https:' && (host === 'claude.ai' || host.endsWith('.claude.ai'))
}

// ─── The page's bridge (the Claude app's fb/m22.java:547-618 and xe9.java:186) ────────────────────

/**
 * The origin rules the bridge runs under as a true document-start script on Android, as the Claude
 * app registers it (m22.java: `https://` + the artifact's host, ct1.java, for both the pane object
 * and the relay, through androidx.webkit addDocumentStartJavaScript). Always claude.ai, which is
 * where the shell and its login live, plus the artifact's own host when it is another claude.ai
 * subdomain (preview.claude.ai). Never the content frame's claudeusercontent.com host and never
 * the sign-in providers: the bridge is the shell's alone.
 */
export function artifactViewerDocumentStartOrigins(artifactUrl: string): string[] {
  const origins = ['https://claude.ai']
  try {
    const url = new URL(artifactUrl)
    const host = url.hostname.toLowerCase()
    if (url.protocol === 'https:' && host !== 'claude.ai' && host.endsWith('.claude.ai')) {
      origins.push(`https://${host}`)
    }
  } catch {
    // Not a URL: claude.ai alone.
  }
  return origins
}

/**
 * What the viewer injects as the page starts, in the top frame only (the script returns at once in
 * a frame). First the object the artifact shell reads to know it is embedded in a native pane:
 * `chrome: "none"` asks it to draw no bar of its own (ours is the bar), and `mode` is the app's
 * scheme. Then the app's own document-start relay (m22.java:571), which forwards the shell's
 * `__frame_chrome_state` echoes to the app; it posts to `window.ReactNativeWebView` where the app's
 * posts to its `artifactChromeState` channel, and like the app's it checks that the channel is there
 * before each post.
 *
 * How it gets there on Android: the patched react-native-webview 13.16.2
 * (patches/react-native-webview@13.16.2.patch) registers it with androidx.webkit 1.14.0
 * `WebViewCompat.addDocumentStartJavaScript` under artifactViewerDocumentStartOrigins when the
 * device's WebView reports `WebViewFeature.DOCUMENT_START_SCRIPT`, so it runs before any of the
 * shell's scripts on every claude.ai document, a sign-in and the way back included. The app relies
 * on the same: m22.java registers both scripts once and re-sends neither after a navigation, and
 * neither does this viewer. On a WebView
 * without the feature it still runs the upstream way, with evaluateJavascript from onPageStarted
 * (RNCWebViewClient.java:85-90), which can land after the shell's first scripts. Verified against
 * the source only; whether the shell now always sees the pane object is still a device check.
 *
 * Running twice in one document (the onPageStarted call can follow a document-start run, and lands
 * in whichever document is current) states the pane again but installs no second relay, so no echo
 * is posted twice. The mark is a non-enumerable `Symbol.for` key the shell has no reason to read.
 *
 * `hostcaps` claims `comment-mode` only. The app also claims comments-list, comment-composer,
 * comment-threads, selection-menu, save-file and more, and each of those tells the shell a native
 * screen will take that job over. This viewer builds none of those screens, so it claims none of
 * them, and the shell then draws its own comment threads, composer and selection menu in the page.
 */
export function artifactViewerBridgeScript(mode: 'dark' | 'light'): string {
  return `(() => {
  if (window.top !== window) return;
  window.claudeDesktopArtifactPane = { embedded: true, mode: ${JSON.stringify(mode)}, chrome: "none", hostcaps: "comment-mode" };
  const relayed = Symbol.for("orca.artifactViewer.relay");
  if (window[relayed]) return;
  Object.defineProperty(window, relayed, { value: true });
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.__frame_chrome_state !== true) return;
    const app = window.ReactNativeWebView;
    if (!app || typeof app.postMessage !== "function") return;
    let body;
    try {
      body = JSON.stringify(data);
    } catch (e) {
      return;
    }
    app.postMessage(body);
  });
})();
true;`
}

/** A command the bar sends the shell (xe9.java:186): share, comment mode on or off, or one of the
 *  shell's chrome actions. */
export type ArtifactViewerCommand =
  | { cmd: 'share' }
  | { cmd: 'comment_mode'; on: boolean }
  | { cmd: 'action'; id: 'undo' | 'redo' }

/** The JS that hands the shell one command, posted to its own window at its own origin. */
export function artifactViewerCommandScript(command: ArtifactViewerCommand): string {
  return `window.postMessage(${JSON.stringify({ __frame_chrome: true, ...command })}, location.origin); true;`
}

export type ArtifactViewerChromeAction = { id: 'undo' | 'redo' | 'comment_selection'; disabled: boolean }

/** One message from the page, as the viewer reads it. */
export type ArtifactViewerEcho =
  /** The shell's `title` echo; '' when it states a blank one. */
  | { kind: 'title'; title: string }
  /** The actions the shell offers the bar now; empty when it offers none (`chrome: null`). */
  | { kind: 'chrome'; actions: ArtifactViewerChromeAction[] }
  | { kind: 'comment_mode'; on: boolean; available: boolean }
  | { kind: 'access' }
  /** `document.title`, from the viewer's own title script (TITLE_SCRIPT); null when it says
   *  nothing the passed-in title does not. */
  | { kind: 'document-title'; title: string | null }

const ACTION_IDS = new Set(['undo', 'redo', 'comment_selection'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function chromeActions(chrome: unknown): ArtifactViewerChromeAction[] | undefined {
  if (chrome === null) {
    return []
  }
  const actions = record(chrome)?.actions
  if (!Array.isArray(actions)) {
    return undefined
  }
  const read: ArtifactViewerChromeAction[] = []
  for (const entry of actions) {
    const action = record(entry)
    if (action && typeof action.id === 'string' && ACTION_IDS.has(action.id)) {
      read.push({ id: action.id as ArtifactViewerChromeAction['id'], disabled: action.disabled === true })
    }
  }
  return read
}

/**
 * The one message the page posted, or undefined when the viewer ignores it: not from a claude.ai
 * https page, not JSON, an echo kind it does not know, or an echo that names another artifact's
 * uuid. The shell's echoes are `{__frame_chrome_state: true, state: <kind>, …}`; the viewer's own
 * title script posts `{artifactTitle}`.
 */
export function artifactViewerEcho(data: string, fromUrl: string | undefined, artifactUrl: string, uuid: string): ArtifactViewerEcho | undefined {
  if (!artifactViewerTrustsOrigin(fromUrl)) {
    return undefined
  }
  let parsed: Record<string, unknown> | null
  try {
    parsed = record(JSON.parse(data))
  } catch {
    return undefined
  }
  if (parsed === null) {
    return undefined
  }
  if (parsed.__frame_chrome_state !== true) {
    const title = parsed.artifactTitle
    return typeof title === 'string' ? { kind: 'document-title', title: documentTitle(title, fromUrl, artifactUrl) } : undefined
  }
  if (parsed.uuid !== undefined && (typeof parsed.uuid !== 'string' || parsed.uuid.toLowerCase() !== uuid.toLowerCase())) {
    return undefined
  }
  switch (parsed.state) {
    case 'title':
      return typeof parsed.title === 'string' ? { kind: 'title', title: parsed.title.trim().slice(0, TITLE_MAX) } : undefined
    case 'chrome': {
      const actions = chromeActions(parsed.chrome)
      return actions === undefined ? undefined : { kind: 'chrome', actions }
    }
    case 'comment_mode':
      return { kind: 'comment_mode', on: parsed.on === true, available: parsed.available === true }
    case 'access':
      return { kind: 'access' }
    default:
      return undefined
  }
}

/**
 * What `document.title` adds to the bar. An empty title, or one that is only the address, is null,
 * and so is the shell's bare "Claude" before the artifact's own metadata arrives: neither says
 * anything the passed-in title does not.
 */
function documentTitle(title: string, fromUrl: string | undefined, artifactUrl: string): string | null {
  const trimmed = title.trim().slice(0, TITLE_MAX)
  if (trimmed === '' || trimmed === 'Claude' || trimmed === artifactUrl || trimmed === fromUrl || /^https?:\/\//i.test(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * The bar's title, as the Claude app picks it (sq30.java:1134-1158): the shell's `title` echo once
 * it has sent one, and "Artifact" (ccr_artifact_card_fallback_title) when that echo is blank;
 * before any echo, the one it was opened with, else "Artifact". `document.title` stands in for the
 * echo until one arrives, so a shell that never sends one still titles the bar.
 */
export function artifactViewerTitle(
  pageTitle: string | null,
  passed: string | null | undefined,
  echoTitle: string | null = null
): string {
  if (echoTitle !== null) {
    return echoTitle || 'Artifact'
  }
  return pageTitle || passed?.trim() || 'Artifact'
}

/** The window the Claude app shows its viewer in as a side sheet rather than full screen
 *  (s8w, ve9.java:484 and fhw.java:20-22): Material's expanded width, 840 dp, at least 480 dp
 *  tall. */
export function artifactViewerAsSidePanel(width: number, height: number): boolean {
  return width >= 840 && height >= 480
}

/** The side sheet's width, dp (i6c.java:1450-1488). */
export const ARTIFACT_VIEWER_SIDE_PANEL_WIDTH = 412

/** An address as the "This link goes to:" line shows it: host and path, without the query a
 *  share key or a tracker rides on. The whole string when it is not a URL. */
export function artifactViewerLinkAddress(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return raw
  }
}
