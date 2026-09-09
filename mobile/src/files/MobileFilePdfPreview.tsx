import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Pdf from 'react-native-pdf'
import { Check, Download } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'
import { savePreviewedPdf } from './mobile-pdf-download-device'
import type { MobilePdfDownloadOutcome } from './mobile-pdf-download'

const SAVE_FEEDBACK_MS = 2200

/** In-app PDF viewer for the file explorer and session file tabs. `uri` is
 *  normally a file in the app cache written by `resolveMobilePdfUri` (fast to
 *  hand to the native view, free to reopen); a data: URI is the fallback.
 *  Pinch zoom and page paging come from the native view. */
export function MobileFilePdfPreview({ uri, fileName }: { uri: string; fileName?: string }) {
  const { colors } = useTheme()
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [page, setPage] = useState(1)
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
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pdf
        source={{ uri, cache: false }}
        style={{ flex: 1, backgroundColor: colors.bg }}
        trustAllCerts={false}
        enablePaging={false}
        spacing={8}
        onLoadComplete={(count) => setPageCount(count)}
        onPageChanged={(current) => setPage(current)}
        onError={() => setError("Couldn't open this PDF")}
        renderActivityIndicator={() => (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        )}
      />
      <View
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8
        }}
      >
        {saveLabel ? (
          <Text
            style={{
              color: saveState === 'failed' ? colors.danger : colors.textSecondary,
              fontSize: 12,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: colors.bgPanel,
              borderWidth: 1,
              borderColor: colors.border
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
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.bgRaised : colors.bgPanel,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: saveState === 'saving' ? 0.6 : 1
          })}
        >
          {saveState === 'saved' ? (
            <Check size={18} color={colors.text} strokeWidth={2.2} />
          ) : (
            <Download size={18} color={colors.text} strokeWidth={2.2} />
          )}
        </Pressable>
      </View>
      {pageCount !== null ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: colors.bgPanel,
            borderWidth: 1,
            borderColor: colors.border
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {page} / {pageCount}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
