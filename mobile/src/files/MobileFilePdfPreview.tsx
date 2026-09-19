import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Pdf from 'react-native-pdf'
import { Check, Download } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'
import { savePreviewedPdf } from './mobile-pdf-download-device'
import type { MobilePdfDownloadOutcome } from './mobile-pdf-download'
import { saveReadingPosition } from '../storage/reading-positions'
import { useRestoredReadingPosition } from './use-reading-position'

const SAVE_FEEDBACK_MS = 2200

/** In-app PDF viewer for the file explorer and session file tabs. `uri` is
 *  normally a file in the app cache written by `resolveMobilePdfUri` (fast to
 *  hand to the native view, free to reopen); a data: URI is the fallback.
 *  Pinch zoom and page paging come from the native view.
 *
 *  `readingPositionKey` names the document across opens; with it, the page
 *  the reader left on is where the document opens next time, app restarts
 *  included. Without it the viewer starts at page 1 every time. */
export function MobileFilePdfPreview({
  uri,
  fileName,
  readingPositionKey = null
}: {
  uri: string
  fileName?: string
  readingPositionKey?: string | null
}) {
  const { colors } = useTheme()
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const restored = useRestoredReadingPosition(readingPositionKey)
  // Why one fixed value per document: react-native-pdf treats every change of
  // its `page` prop as "jump there". So the restored page is decided once,
  // when the position is known, and held for as long as this uri is mounted;
  // the reader's own paging updates `page` above, never this.
  const [initial, setInitial] = useState<{ uri: string; page: number } | null>(null)
  useEffect(() => {
    if (restored === undefined || initial?.uri === uri) {
      return
    }
    const startPage = restored?.kind === 'pdf' ? restored.page : 1
    setInitial({ uri, page: startPage })
    setPage(startPage)
  }, [initial, restored, uri])
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | MobilePdfDownloadOutcome>('idle')
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current)
      }
    },
    []
  )

  const save = async () => {
    if (saveState === 'saving') {
      return
    }
    setSaveState('saving')
    const outcome = await savePreviewedPdf({ uri, fileName: fileName ?? 'document.pdf' })
    setSaveState(outcome)
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current)
    }
    feedbackTimer.current = setTimeout(() => setSaveState('idle'), SAVE_FEEDBACK_MS)
  }
  const saveLabel =
    saveState === 'saved'
      ? 'Saved'
      : saveState === 'failed'
        ? "Couldn't save"
        : saveState === 'saving'
          ? 'Saving…'
          : null

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    )
  }
  if (initial?.uri !== uri) {
    // The stored page is one storage read away; mounting the native view on
    // page 1 first and then jumping would show the jump.
    return (
      <View style={[styles.state, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Why a toolbar and not an overlay: a button floating on the document
          covered the page, and one in the header fought the file name. This
          row is its own space — page counter left, actions right. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.bgPanel
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {pageCount !== null ? `Page ${page} of ${pageCount}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {saveLabel ? (
            <Text
              style={{
                color: saveState === 'failed' ? colors.danger : colors.textSecondary,
                fontSize: 12
              }}
            >
              {saveLabel}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download PDF"
            onPress={() => void save()}
            disabled={saveState === 'saving'}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: pressed ? colors.bgRaised : colors.bg,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: saveState === 'saving' ? 0.6 : 1
            })}
          >
            {saveState === 'saved' ? (
              <Check size={16} color={colors.text} strokeWidth={2.2} />
            ) : (
              <Download size={16} color={colors.text} strokeWidth={2.2} />
            )}
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>Download</Text>
          </Pressable>
        </View>
      </View>
      <Pdf
        key={uri}
        source={{ uri, cache: false }}
        page={initial.page}
        style={{ flex: 1, backgroundColor: colors.bg }}
        trustAllCerts={false}
        enablePaging={false}
        spacing={8}
        onLoadComplete={(count) => setPageCount(count)}
        onPageChanged={(current, count) => {
          setPage(current)
          if (readingPositionKey) {
            saveReadingPosition(readingPositionKey, {
              kind: 'pdf',
              page: current,
              pageCount: count > 0 ? count : (pageCount ?? current)
            })
          }
        }}
        onError={() => setError("Couldn't open this PDF")}
        renderActivityIndicator={() => (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        )}
      />
    </View>
  )
}
