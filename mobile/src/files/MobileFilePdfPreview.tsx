import { useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import Pdf from 'react-native-pdf'
import { useTheme } from '../theme/theme-context'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

/** In-app PDF viewer for the file explorer and session file tabs. `uri` is
 *  normally a file in the app cache written by `resolveMobilePdfUri` (fast to
 *  hand to the native view, free to reopen); a data: URI is the fallback.
 *  Pinch zoom and page paging come from the native view. */
export function MobileFilePdfPreview({ uri }: { uri: string }) {
  const { colors } = useTheme()
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

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
