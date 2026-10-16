import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ConfirmModal } from '../src/components/ConfirmModal'
import { openExternalLink } from '../src/platform/external-link'
import {
  ARTIFACT_VIEWER_SIDE_PANEL_WIDTH,
  artifactViewerAsSidePanel,
  artifactViewerLinkAddress
} from '../src/session/artifact-viewer-policy'
import { parseClaudeArtifactLink, type ClaudeArtifactLink } from '../src/session/claude-artifacts'
import { isArtifactShortcutKey } from '../src/session/claude-artifact-shortcut-key'
import { MobileArtifactViewer } from '../src/session/MobileArtifactViewer'
import { useArtifactViewerOwnsArtifact } from '../src/session/use-artifact-viewer-ownership'
import { useTheme } from '../src/theme/theme-context'

/**
 * A claude.ai artifact in the app's own viewer (openClaudeArtifact, open-claude-artifact.ts).
 * `url` is the artifact's link, `title` the one the card or list knew for it, and `external=1`
 * says the link came from outside the app (every system link is marked so,
 * claude-artifact-native-intent.ts). `k` is the key Code UI's own home-screen shortcut carries
 * (claude-artifact-shortcut-key.ts): when it checks out, the link opens at once, as the Claude
 * app's shortcut does; anything else asks first.
 *
 * Only a claude.ai artifact link is loaded here (parseClaudeArtifactLink): a deep link naming any
 * other address is handed to the browser and the screen closes, so this route cannot be used to
 * load an arbitrary page in a WebView that holds the claude.ai sign-in.
 */
export default function ArtifactViewerRoute() {
  const router = useRouter()
  const { url, title, external, k } = useLocalSearchParams<{ url?: string; title?: string; external?: string; k?: string }>()
  const fromOutside = external === '1'
  // null while the shortcut key is checked: neither the page nor the question shows until then.
  const [shortcut, setShortcut] = useState<boolean | null>(fromOutside && k ? null : false)
  useEffect(() => {
    if (!fromOutside || !k) {
      setShortcut(false)
      return
    }
    let live = true
    setShortcut(null)
    isArtifactShortcutKey(k).then(
      (ok) => live && setShortcut(ok),
      () => live && setShortcut(false)
    )
    return () => {
      live = false
    }
  }, [fromOutside, k])
  const close = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }, [router])
  const link = typeof url === 'string' ? parseClaudeArtifactLink(url) : null
  const refused = link === null
  useEffect(() => {
    if (refused) {
      // Only a web link is handed on: the route is reachable by deep link, and it must not forward
      // an intent:, file: or app scheme it was given (review 2026-10-16).
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        openExternalLink(url)
      }
      close()
    }
  }, [refused, url, close])
  if (link === null) {
    return null
  }
  if (shortcut === null) {
    return null
  }
  return <ArtifactViewerScreen link={link} title={title ?? null} external={fromOutside && !shortcut} onClose={close} />
}

/**
 * The viewer in its frame. On a large window, at least 840 dp wide and 480 dp tall, the Claude app
 * shows it as a side sheet 412 dp wide over the dimmed screen that opened it (its s8w SideSheet,
 * ve9.java:484, i6c.java:1450-1488, fhw.java:20-22), and a tap on the dimmed part closes it; below
 * that it fills the screen. The route is a transparent modal (app/_layout.tsx) so the opening
 * screen stays drawn under the dim.
 *
 * A link from another app asks first (qc1.java:148-150, hr3.java:182-216), so a page another app
 * sends is never opened signed in without the user seeing where it goes. The dialog's words are
 * inferred from the app's generic link dialog ("Open this website?" / "This link goes to:",
 * sq30.java:718-735); the app's own strings for this one were not found.
 */
function ArtifactViewerScreen({
  link,
  title,
  external,
  onClose
}: {
  link: ClaudeArtifactLink
  title: string | null
  external: boolean
  onClose: () => void
}) {
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const own = useArtifactViewerOwnsArtifact(link.uuid)
  const [confirmed, setConfirmed] = useState(!external)
  // ConfirmModal calls onCancel after onConfirm too (it closes itself that way), so Cancel must
  // know an Open came first, before the state that says so has rendered.
  const opening = useRef(!external)
  const side = artifactViewerAsSidePanel(width, height)

  const body = confirmed ? (
    <MobileArtifactViewer url={link.url} uuid={link.uuid} title={title} own={own} onClose={onClose} />
  ) : (
    <View style={{ flex: 1, backgroundColor: colors.bg }} />
  )
  return (
    <>
      {side ? (
        <View testID="artifact-viewer-frame" style={{ flex: 1, flexDirection: 'row' }}>
          <Pressable
            testID="artifact-viewer-scrim"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={{ flex: 1, backgroundColor: colors.sheetScrim }}
          />
          <View testID="artifact-viewer-panel" style={{ width: ARTIFACT_VIEWER_SIDE_PANEL_WIDTH, backgroundColor: colors.bg }}>
            {body}
          </View>
        </View>
      ) : (
        <View testID="artifact-viewer-frame" style={{ flex: 1, backgroundColor: colors.bg }}>
          {body}
        </View>
      )}
      {external ? (
        <ConfirmModal
          visible={!confirmed}
          title="Open this artifact?"
          message={`This link goes to:\n${artifactViewerLinkAddress(link.url)}`}
          cancelLabel="Cancel"
          confirmLabel="Open"
          onConfirm={() => {
            opening.current = true
            setConfirmed(true)
          }}
          onCancel={() => {
            if (!opening.current) {
              onClose()
            }
          }}
        />
      ) : null}
    </>
  )
}
