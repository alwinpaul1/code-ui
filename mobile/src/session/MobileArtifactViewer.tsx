import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import { ConfirmModal } from '../components/ConfirmModal'
import { openExternalLink } from '../platform/external-link'
import { useBackClaim } from '../navigation/use-back-claim'
import { useTheme } from '../theme/theme-context'
import { FloatingToast } from '../ui/FloatingToast'
import { Txt } from '../ui/Txt'
import {
  artifactViewerBridgeScript,
  artifactViewerCommandScript,
  artifactViewerDocumentStartOrigins,
  artifactViewerEcho,
  artifactViewerKeepsNavigation,
  artifactViewerKeepsPopup,
  artifactViewerTitle,
  type ArtifactViewerChromeAction,
  type ArtifactViewerCommand
} from './artifact-viewer-policy'
import { ClaudeCdsGlyph, type ClaudeCdsGlyphName } from './ClaudeCdsGlyph'
import { pinClaudeArtifactShortcut } from './claude-artifact-shortcut'
import { parseClaudeArtifactLink } from './claude-artifacts'
import { openUrlOutsideApp } from './open-outside-app'

/** The words of the viewer's error state (sq30.java:1569-1593, l79.java:382-397). The app also
 *  has "Couldn't sign in to show this artifact." for a failed sign-in, but nothing this WebView
 *  reports tells a failed sign-in from a failed load, so the one text stands for both. */
export const ARTIFACT_VIEWER_ERROR = "Couldn't load this artifact."

/** The bar's toasts for an Add to home screen that did not add one. A pinned shortcut needs none:
 *  the launcher shows its own confirmation. */
export const ARTIFACT_VIEWER_ALREADY_HOME = 'Already on your home screen'
export const ARTIFACT_VIEWER_HOME_FAILED = "Couldn't add to home screen"
const TOAST_MS = 3000

/**
 * Reports `document.title` as it changes. The shell's own `title` echo is the bar's title once it
 * sends one (artifactViewerTitle); this keeps the bar titled by the page when it does not.
 */
const TITLE_SCRIPT = `(function () {
  var last = null;
  function say() {
    var title = document.title || '';
    if (title === last || !window.ReactNativeWebView) { return; }
    last = title;
    window.ReactNativeWebView.postMessage(JSON.stringify({ artifactTitle: title }));
  }
  say();
  new MutationObserver(say).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})();
true;`

const GLYPH = 24

/**
 * Hands an address to the browser. A claude.ai artifact link goes through openUrlOutsideApp: Code
 * UI registers for those links itself, so with "Open supported links" on, a plain open would come
 * straight back into this viewer instead of reaching the browser.
 */
function openOutside(address: string): void {
  if (parseClaudeArtifactLink(address) !== null) {
    void openUrlOutsideApp(address)
  } else {
    openExternalLink(address)
  }
}

type CommentMode = { on: boolean; available: boolean }
const NO_COMMENTS: CommentMode = { on: false, available: false }

/**
 * A claude.ai artifact, in the app, as the Claude Android app 1.261013.20 shows one (sq30.java).
 *
 * The bar (sq30.java:1134-1168, 4155-4290): Close at the start; the title; and at the end, 8 dp
 * apart, Undo and Redo while the page offers them, Comments while the page has comments to offer,
 * Add to home screen for the user's own artifact once it has loaded, and Share for the user's own
 * artifact or Open in browser for anyone else's. There is no overflow menu and no Print.
 *
 * The page is claude.ai's artifact shell, told before its scripts run (a document-start script on
 * Android where the WebView supports one) that it is embedded in a native pane
 * (artifactViewerBridgeScript). It reports its title, its undo/redo actions and its
 * comment mode back as echoes, and the bar drives it by posting commands into it. Signed out it
 * offers "Sign in"; that flow and its providers stay in this WebView, and the cookie it leaves is
 * shared with every later artifact. Any other top-level navigation is a link out of the page, and
 * the viewer asks before handing it to the browser (sq30.java:718-735). The page's content runs in
 * its own frame on another host, so frames are left alone.
 *
 * Back steps back inside the page first, then closes the viewer.
 */
export function MobileArtifactViewer({
  url,
  uuid,
  title,
  own = false,
  onClose
}: {
  url: string
  /** The artifact's uuid: an echo naming another one is ignored. */
  uuid: string
  title?: string | null
  /** The user's own artifact (use-artifact-viewer-ownership.ts): Share and Add to home screen. */
  own?: boolean
  onClose: () => void
}) {
  const { colors, space, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const webRef = useRef<WebView>(null)
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  const [echoTitle, setEchoTitle] = useState<string | null>(null)
  const [actions, setActions] = useState<readonly ArtifactViewerChromeAction[]>([])
  const [comments, setComments] = useState<CommentMode>(NO_COMMENTS)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [linkOut, setLinkOut] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const shown = artifactViewerTitle(pageTitle, title, echoTitle)
  const bridge = useMemo(() => artifactViewerBridgeScript(isDark ? 'dark' : 'light'), [isDark])
  const bridgeOrigins = useMemo(() => artifactViewerDocumentStartOrigins(url), [url])

  useBackClaim(
    canGoBack && !failed
      ? () => {
          webRef.current?.goBack()
          return true
        }
      : null
  )

  useEffect(() => {
    if (toast === null) {
      return
    }
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** What the shell said about the page it drew belongs to that page: a new one starts bare. */
  const forgetPage = useCallback(() => {
    setActions([])
    setComments(NO_COMMENTS)
  }, [])

  const retry = useCallback(() => {
    setFailed(false)
    setLoading(true)
    setLoaded(false)
    forgetPage()
    // The error column took the WebView's place, so this mounts a new one on the artifact's own
    // address rather than `reload()`ing whatever error page the old one was left on.
    setCanGoBack(false)
  }, [forgetPage])

  const send = useCallback((command: ArtifactViewerCommand) => {
    webRef.current?.injectJavaScript(artifactViewerCommandScript(command))
  }, [])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const echo = artifactViewerEcho(event.nativeEvent.data, event.nativeEvent.url, url, uuid)
      if (echo === undefined) {
        return
      }
      switch (echo.kind) {
        case 'title':
          setEchoTitle(echo.title)
          return
        case 'document-title':
          setPageTitle(echo.title)
          return
        case 'chrome':
          setActions(echo.actions)
          return
        case 'comment_mode':
          setComments({ on: echo.on, available: echo.available })
          return
        case 'access':
          // The app reads who may see the page from it; nothing on this bar turns on it.
          return
        default: {
          const unknown: never = echo
          return unknown
        }
      }
    },
    [url, uuid]
  )

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack)
  }, [])

  const addToHome = useCallback(() => {
    if (adding) {
      return
    }
    setAdding(true)
    pinClaudeArtifactShortcut({ url, title: shown })
      .catch((error: unknown) => {
        console.warn(`[artifacts] the home screen shortcut could not be added: ${error instanceof Error ? error.message : String(error)}`)
        return 'failed' as const
      })
      .then((result) => {
        if (!mounted.current) {
          return
        }
        setAdding(false)
        if (result === 'already') {
          setToast(ARTIFACT_VIEWER_ALREADY_HOME)
        } else if (result === 'unsupported' || result === 'failed') {
          setToast(ARTIFACT_VIEWER_HOME_FAILED)
        }
      })
  }, [adding, url, shown])

  const undo = actions.find((action) => action.id === 'undo')
  const redo = actions.find((action) => action.id === 'redo')
  const button = (props: {
    testID: string
    glyph: ClaudeCdsGlyphName
    label: string
    onPress: () => void
    disabled?: boolean
    busy?: boolean
    actionLabel?: string
    selected?: boolean
  }) => (
    <Pressable
      key={props.testID}
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true, busy: props.busy === true, selected: props.selected }}
      // The app's onClickLabel: what a tap does, read after the button's name.
      accessibilityActions={props.actionLabel ? [{ name: 'activate', label: props.actionLabel }] : undefined}
      onAccessibilityAction={props.actionLabel ? props.onPress : undefined}
      disabled={props.disabled}
      onPress={props.onPress}
      style={styles.iconButton}
    >
      <ClaudeCdsGlyph name={props.glyph} size={GLYPH} color={props.disabled ? colors.textSecondary : colors.text} />
    </Pressable>
  )

  return (
    <View testID="artifact-viewer" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        testID="artifact-viewer-bar"
        style={{
          paddingTop: insets.top,
          minHeight: 56 + insets.top,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.xs,
          gap: space.xs,
          backgroundColor: colors.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border
        }}
      >
        {button({ testID: 'artifact-viewer-close', glyph: 'x', label: 'Close', onPress: onClose })}
        <Txt
          testID="artifact-viewer-title"
          variant="heading"
          weight="semibold"
          // Two lines when Undo and Redo crowd the bar, else one (sq30.java:1160-1168).
          numberOfLines={undo || redo ? 2 : 1}
          style={{ flex: 1 }}
        >
          {shown}
        </Txt>
        <View testID="artifact-viewer-actions" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {undo ? button({ testID: 'artifact-viewer-undo', glyph: 'arrowCounterClockwise', label: 'Undo', disabled: undo.disabled, onPress: () => send({ cmd: 'action', id: 'undo' }) }) : null}
          {redo ? button({ testID: 'artifact-viewer-redo', glyph: 'arrowClockwise', label: 'Redo', disabled: redo.disabled, onPress: () => send({ cmd: 'action', id: 'redo' }) }) : null}
          {comments.available
            ? button({
                testID: 'artifact-viewer-comments',
                glyph: comments.on ? 'chatsFilled' : 'chats',
                label: 'Comments',
                actionLabel: comments.on ? 'Stop commenting' : 'Comment',
                selected: comments.on,
                // ko30.java:242-261 opens its native threads sheet while comment mode is on; this
                // viewer has none (the shell draws its own), so a tap only turns the mode over.
                onPress: () => send({ cmd: 'comment_mode', on: !comments.on })
              })
            : null}
          {own && loaded && !failed
            ? button({
                testID: 'artifact-viewer-add-home',
                glyph: 'home',
                label: adding ? 'Adding to home screen…' : 'Add to home screen',
                disabled: adding,
                busy: adding,
                onPress: addToHome
              })
            : null}
          {own && !failed
            ? button({ testID: 'artifact-viewer-share', glyph: 'share', label: 'Share', onPress: () => send({ cmd: 'share' }) })
            : button({ testID: 'artifact-viewer-open-browser', glyph: 'arrowOutSquare', label: 'Open in browser', onPress: () => openOutside(url) })}
        </View>
      </View>
      {failed ? (
        <View testID="artifact-viewer-error" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: space.md }}>
          <Txt variant="body" align="center">
            {ARTIFACT_VIEWER_ERROR}
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Pressable
              testID="artifact-viewer-retry"
              accessibilityRole="button"
              onPress={retry}
              style={[styles.textButton, { backgroundColor: colors.text }]}
            >
              <Txt variant="label" weight="semibold" style={{ color: colors.bg }}>
                Retry
              </Txt>
            </Pressable>
            <Pressable
              testID="artifact-viewer-error-open-browser"
              accessibilityRole="button"
              onPress={() => openOutside(url)}
              style={[styles.textButton, { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong }]}
            >
              <Txt variant="label" weight="semibold">
                Open in browser
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            ref={webRef}
            testID="artifact-viewer-webview"
            style={{ flex: 1, backgroundColor: colors.bg }}
            source={{ uri: url }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            // A `target="_blank"` link or a sign-in popup comes to onOpenWindow instead of opening
            // a window this screen has nowhere to put.
            setSupportMultipleWindows
            injectedJavaScriptBeforeContentLoaded={bridge}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            // Android: registered as a true document-start script under these origins where the
            // WebView supports it (the patched react-native-webview; artifactViewerBridgeScript).
            injectedJavaScriptBeforeContentLoadedOrigins={bridgeOrigins}
            injectedJavaScript={TITLE_SCRIPT}
            onMessage={onMessage}
            onNavigationStateChange={onNavigationStateChange}
            onShouldStartLoadWithRequest={(request) => {
              if (request.isTopFrame === false || artifactViewerKeepsNavigation(request.url)) {
                return true
              }
              setLinkOut(request.url)
              return false
            }}
            onOpenWindow={(event) => {
              const target = event.nativeEvent.targetUrl
              // A blank popup has nowhere to go: it neither replaces the page nor asks.
              if (target === 'about:blank' || target === '') {
                return
              }
              if (artifactViewerKeepsPopup(target)) {
                webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(target)});true;`)
              } else {
                setLinkOut(target)
              }
            }}
            onLoadStart={() => {
              setLoading(true)
              forgetPage()
            }}
            onLoadEnd={() => {
              setLoading(false)
              setLoaded(true)
            }}
            onError={(event) => {
              console.warn('[artifacts] the artifact page did not load', { url, description: event.nativeEvent.description })
              setFailed(true)
              setLoaded(false)
            }}
            onHttpError={(event) => {
              // 401 and 403 are the shell telling a signed-out phone to sign in, with the page that
              // says so; the error column would hide its Sign in button.
              const status = event.nativeEvent.statusCode
              if (status === 401 || status === 403) {
                return
              }
              console.warn('[artifacts] the artifact page answered with an error', { url, status })
              setFailed(true)
              setLoaded(false)
            }}
          />
          {/* After the page in the tree, so it paints over it with no z-index. */}
          {loading ? (
            <View testID="artifact-viewer-loading" pointerEvents="none" style={styles.loading}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : null}
        </View>
      )}
      <FloatingToast message={toast} />
      <ConfirmModal
        visible={linkOut !== null}
        title="Open this website?"
        message={`This link goes to:\n${linkOut ?? ''}`}
        cancelLabel="Cancel"
        confirmLabel="Open"
        onConfirm={() => {
          if (linkOut !== null) {
            openOutside(linkOut)
          }
        }}
        onCancel={() => setLinkOut(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // The app's icon buttons are 48 dp tap targets (MIN_TAP_TARGET, tap-target-audit.test.ts).
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  textButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  loading: { position: 'absolute', top: 24, left: 0, right: 0, alignItems: 'center' }
})
