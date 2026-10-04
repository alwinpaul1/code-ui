import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { AppState, Platform, View } from 'react-native'
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import {
  describeNativeWebViewEngineError,
  TerminalWebViewEngineErrorOverlay
} from './terminal-webview-engine-error-state'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'
import { XTERM_WEBVIEW_SOURCE } from './terminal-webview-html'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { useTerminalWebViewController } from './use-terminal-webview-controller'

type Props = TerminalWebViewProps

type RenderProcessGoneEvent = Parameters<NonNullable<WebViewProps['onRenderProcessGone']>>[0]

export type { TerminalWebViewHandle } from './terminal-webview-contract'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(
  function TerminalWebView(props, ref) {
    const webViewRef = useRef<WebView>(null)

    const post = useCallback((command: TerminalWebViewCommand & { id: number }) => {
      webViewRef.current?.postMessage(JSON.stringify(command))
    }, [])

    const {
      clearEngineError,
      engineError,
      handle,
      receive,
      reportEngineError,
      reportNativeEngineError,
      resetReadiness
    } = useTerminalWebViewController(props, {
      post,
      // iOS can preserve the native view while discarding its JS/backing-store state.
      pingsOnForegroundRecovery: () => Platform.OS === 'ios'
    })

    // Code UI (upstream reloads the dead view): which native WebView is mounted. A new key is a new
    // WebView with a new renderer; the controller, the handle and the session's ref stay the same.
    const [webViewKey, setWebViewKey] = useState(0)
    // Whether the mounted WebView's document has reported itself ready. A renderer that dies before
    // that is not remounted on its own again, so a renderer that cannot stay up cannot loop.
    const documentCameUpRef = useRef(false)
    // A renderer the system killed while the app was in the background, remounted on return.
    const remountWhenActiveRef = useRef(false)

    useImperativeHandle(ref, () => handle, [handle])

    const remountWebView = useCallback(() => {
      remountWhenActiveRef.current = false
      documentCameUpRef.current = false
      clearEngineError()
      resetReadiness()
      setWebViewKey((key) => key + 1)
    }, [clearEngineError, resetReadiness])

    useEffect(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active' && remountWhenActiveRef.current) {
          remountWebView()
        }
      })
      return () => subscription.remove()
    }, [remountWebView])

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
        } catch {
          return
        }
        if (msg.type === 'web-ready') {
          documentCameUpRef.current = true
        }
        receive(msg)
      },
      [receive]
    )

    // A new WebView rather than reload(): after a renderer loss the old one cannot be used, and a
    // fresh one is the same recovery for every other failure the overlay reports.
    const handleReload = remountWebView

    /**
     * Android's renderer is gone: killed by the system (memory, usually in the background) or
     * crashed. react-native-webview 13.16.2 only reports it, and "the given WebView can't be used,
     * and should be removed from the view hierarchy" (WebViewClient#onRenderProcessGone), so the
     * recovery is a new WebView. Its document reports web-ready and the session re-subscribes the
     * pane for a fresh snapshot. A kill is remounted on its own once the app is in front; a crash,
     * or a second loss before the new document came up, shows the overlay and its Reload instead.
     */
    const handleRenderProcessGone = useCallback(
      (event: RenderProcessGoneEvent) => {
        // Nothing may be posted to the dead view, and nothing queued for it is the next one's.
        resetReadiness()
        if (event.nativeEvent?.didCrash === true || !documentCameUpRef.current) {
          reportNativeEngineError('Terminal WebView render process ended', event)
          return
        }
        reportEngineError(
          `${describeNativeWebViewEngineError('Terminal WebView render process ended', event)} - remounting`,
          false
        )
        if (AppState.currentState === 'active') {
          remountWebView()
        } else {
          remountWhenActiveRef.current = true
        }
      },
      [remountWebView, reportEngineError, reportNativeEngineError, resetReadiness]
    )

    const handleContentProcessDidTerminate = useCallback(() => {
      // Why: WKWebView content-process loss is recoverable; stale commands belong
      // to the dead document and the replacement must prove readiness before replay.
      resetReadiness()
      clearEngineError()
      webViewRef.current?.reload()
    }, [clearEngineError, resetReadiness])

    return (
      <View style={[TERMINAL_WEBVIEW_FRAME_STYLES.container, props.style]}>
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={XTERM_WEBVIEW_SOURCE}
          style={TERMINAL_WEBVIEW_FRAME_STYLES.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          scrollEnabled={false}
          // Why: Android parent gesture containers can intercept vertical drags
          // before the injected xterm scroll router sees them.
          nestedScrollEnabled
          // Why: the document is overflow:hidden and JS owns the gesture, so the
          // platform's own overscroll glow/stretch is pure work against the frame.
          overScrollMode="never"
          scalesPageToFit={false}
          // Why: Android WebView defaults textZoom to the system font scale, inflating
          // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
          textZoom={100}
          onLoadStart={resetReadiness}
          onMessage={handleMessage}
          onError={(event) => reportNativeEngineError('Terminal WebView load failed', event)}
          onHttpError={(event) => reportNativeEngineError('Terminal WebView HTTP error', event)}
          onRenderProcessGone={handleRenderProcessGone}
          onContentProcessDidTerminate={handleContentProcessDidTerminate}
        />
        {engineError ? (
          <TerminalWebViewEngineErrorOverlay message={engineError} onReload={handleReload} />
        ) : null}
      </View>
    )
  }
)
