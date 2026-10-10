import { useMemo } from 'react'
import { WebView } from 'react-native-webview'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { mobileMediaPreviewDocument } from './mobile-media-preview-document'
import { filePreviewStyles } from './mobile-file-preview-styles'

export type MobileMediaPlaybackProps = { uri: string; mimeType: string; title: string }

export function MobileMediaPlayback({ uri, mimeType, title }: MobileMediaPlaybackProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(filePreviewStyles)
  // The page paints the live theme's page colours, so a light session plays on a light page.
  const html = useMemo(
    () => mobileMediaPreviewDocument(uri, mimeType, title, colors),
    [uri, mimeType, title, colors]
  )
  return (
    <WebView
      style={styles.container}
      source={{ html, baseUrl: uri }}
      originWhitelist={['about:blank', 'file://*']}
      allowingReadAccessToURL={uri}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mediaPlaybackRequiresUserAction
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url === uri}
    />
  )
}
