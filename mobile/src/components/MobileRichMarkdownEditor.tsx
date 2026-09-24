import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef
} from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import { openExternalLink } from '../platform/external-link'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import { MobileRichMarkdownToolbar } from './MobileRichMarkdownToolbar'
import type {
  MobileRichMarkdownCommand,
  MobileRichMarkdownEditorMessage,
  MobileRichMarkdownEditorProps
} from './mobile-rich-markdown-editor-contract'
import { useMobileRichMarkdownEditorController } from './use-mobile-rich-markdown-editor-controller'
import {
  buildMobileRichMarkdownEditorHtml,
  buildRichMarkdownEditorThemeScript,
  escapeInjectedJavaScriptString
} from './mobile-rich-markdown-editor-html'

const EDITOR_DOCUMENT_ORIGIN = 'https://orca-mobile-editor.invalid'
const EDITOR_DOCUMENT_URL = `${EDITOR_DOCUMENT_ORIGIN}/rich-markdown-editor`

/** Exported so the web sibling answers the same shape and a change to it fails there too. */
export type MobileRichMarkdownEditorComponentProps = Omit<
  MobileRichMarkdownEditorProps,
  'onOpenLink'
> & {
  onOpenLink?: (url: string) => void
}

export type MobileRichMarkdownEditorHandle = {
  dismissKeyboard: () => void
}

function MobileRichMarkdownEditorInner(
  {
    content,
    editable,
    onChange,
    onKeyboardInsetChange,
    onOpenLink
  }: MobileRichMarkdownEditorComponentProps,
  ref: ForwardedRef<MobileRichMarkdownEditorHandle>
) {
  const webViewRef = useRef<WebView>(null)
  const theme = useTheme()
  const styles = useThemedStyles(createStyles)
  // Built once, in the theme the editor opened in: a rebuilt document reloads
  // and drops the caret. A later switch is written into the live one instead.
  const [openedIn] = useState(() => ({ colors: theme.colors, scheme: theme.scheme }))
  const html = useMemo(() => buildMobileRichMarkdownEditorHtml(openedIn), [openedIn])

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`)
  }, [])
  const themeRef = useRef(theme)
  // Also run on every load, so a reloaded WebView cannot come back in the
  // theme it first opened in.
  const applyTheme = useCallback(() => inject(buildRichMarkdownEditorThemeScript(themeRef.current)), [inject])
  useEffect(() => {
    themeRef.current = theme
    applyTheme()
  }, [applyTheme, theme])

  const transport = useMemo(
    () => ({
      setMarkdown: (markdown: string, generation: number) =>
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.setMarkdown(${escapeInjectedJavaScriptString(markdown)}, ${generation});`
        ),
      setEditable: (nextEditable: boolean) =>
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.setEditable(${nextEditable ? 'true' : 'false'});`
        ),
      runCommand: (command: MobileRichMarkdownCommand) =>
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.runCommand(${escapeInjectedJavaScriptString(command)});`
        )
    }),
    [inject]
  )

  const openLink = useCallback(
    (url: string) => {
      if (onOpenLink) {
        onOpenLink(url)
        return
      }
      openExternalLink(url)
    },
    [onOpenLink]
  )

  const { handleMessage, runCommand } = useMobileRichMarkdownEditorController({
    content,
    editable,
    onChange,
    onKeyboardInsetChange,
    onOpenLink: openLink,
    transport
  })

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: unknown
      try {
        message = JSON.parse(event.nativeEvent.data)
      } catch {
        return
      }
      if (!message || typeof message !== 'object') {
        return
      }
      handleMessage(message as Partial<MobileRichMarkdownEditorMessage>)
    },
    [handleMessage]
  )

  const handleShouldStartLoadWithRequest = useCallback((request: { url?: string }) => {
    const url = request.url ?? ''
    const isEditorDocument =
      url === 'about:blank' ||
      url === EDITOR_DOCUMENT_URL ||
      url.startsWith(`${EDITOR_DOCUMENT_URL}#`)
    // Why: editor content is untrusted markdown; links must leave through openLink.
    return isEditorDocument
  }, [])

  const dismissKeyboard = useCallback(() => {
    // Why: the caret lives in the WebView, so the injected blur is what closes the keyboard;
    // Keyboard.dismiss only clears a native TextInput that stole focus first.
    inject('window.__orcaRichMarkdown && window.__orcaRichMarkdown.dismissKeyboard();')
    Keyboard.dismiss()
  }, [inject])

  useImperativeHandle(ref, () => ({ dismissKeyboard }), [dismissKeyboard])

  return (
    <View style={styles.container}>
      <MobileRichMarkdownToolbar editable={editable} onCommand={runCommand} />
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: EDITOR_DOCUMENT_URL }}
        originWhitelist={[EDITOR_DOCUMENT_ORIGIN, 'about:blank']}
        javaScriptEnabled
        domStorageEnabled={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        onMessage={handleWebViewMessage}
        onLoadEnd={applyTheme}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        style={styles.webView}
        scrollEnabled
        bounces={false}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        automaticallyAdjustContentInsets={false}
      />
    </View>
  )
}

export const MobileRichMarkdownEditor = memo(forwardRef(MobileRichMarkdownEditorInner))

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      minHeight: 0,
      backgroundColor: colors.bg
    },
    webView: {
      flex: 1,
      minHeight: 0,
      backgroundColor: colors.bg
    }
  })
}
