import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { openExternalLink } from '../platform/external-link'
import { Txt } from '../ui/Txt'
import { artifactViewerTitle } from './artifact-viewer-policy'
// The native component's own prop type, so a change to it fails here rather than drifting.
import type { MobileArtifactViewer as NativeViewer } from './MobileArtifactViewer'

/**
 * The page's stand-in for the viewer. `react-native-webview` has no browser counterpart (importing
 * it throws, and the route manifest imports every route, mobile-webview-editor-web-fallbacks.test.tsx),
 * and claude.ai refuses to be framed, so the page offers the browser. The page's own
 * `openClaudeArtifact` already opens the browser and never comes here; this is for a deep link.
 */
export function MobileArtifactViewer({ url, title, onClose }: Parameters<typeof NativeViewer>[0]) {
  const { colors, space } = useTheme()
  return (
    <View testID="artifact-viewer" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: space.md, backgroundColor: colors.bg }}>
      <Txt variant="heading" weight="semibold" align="center">
        {artifactViewerTitle(null, title)}
      </Txt>
      <Pressable accessibilityRole="button" onPress={() => openExternalLink(url)}>
        <Txt variant="label" weight="semibold">
          Open in browser
        </Txt>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onClose}>
        <Txt variant="label" tone="secondary">
          Close
        </Txt>
      </Pressable>
    </View>
  )
}
