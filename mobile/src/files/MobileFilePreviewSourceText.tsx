import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, Text, type StyleProp, type TextStyle } from 'react-native'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { DESKTOP_TEXT_READ_CAP } from './mobile-file-preview-response'
import { scrollOffsetForPreviewLine } from './mobile-file-preview-line-column'
import { buildMobileFilePreviewSyntax } from './mobile-file-preview-syntax'
import { filePreviewStyles } from './mobile-file-preview-styles'
import { useTheme, useThemedStyles } from '../theme/theme-context'

export function MobileFilePreviewSourceText({
  relativePath,
  content,
  truncated,
  initialLine
}: {
  relativePath: string
  content: string
  truncated?: boolean
  initialLine?: number
}) {
  const { scheme } = useTheme()
  const styles = useThemedStyles(filePreviewStyles)
  const scrollRef = useRef<ScrollView>(null)
  const revealedRef = useRef(false)
  const syntax = useMemo(
    () => buildMobileFilePreviewSyntax(relativePath, content),
    [content, relativePath]
  )

  useEffect(() => {
    revealedRef.current = false
  }, [content, initialLine, relativePath])

  const revealInitialLine = () => {
    if (!initialLine || revealedRef.current) {
      return
    }
    revealedRef.current = true
    scrollRef.current?.scrollTo({
      y: scrollOffsetForPreviewLine(initialLine),
      animated: false
    })
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.textContent}
      onContentSizeChange={revealInitialLine}
    >
      {truncated ? <MobileFilePreviewTruncatedNote /> : null}
      <Text selectable style={styles.textPreview} accessibilityLabel="File preview">
        <MobileSyntaxSegments segments={syntax.segments} scheme={scheme} />
      </Text>
    </ScrollView>
  )
}

/** Over a text file the desktop cut. It names what the preview shows, not the file's size: the
 *  phone is never told that (DESKTOP_TEXT_READ_CAP), and the reply's byteLength made every file
 *  over the cap "File size: 512 KB". */
export function MobileFilePreviewTruncatedNote({
  // Why: the markdown preview draws this note over a themed surface, so it
  // hands in its own colour. It layers over the shared one rather than
  // replacing it, so a field added below still reaches every caller.
  style
}: {
  style?: StyleProp<TextStyle>
}) {
  const styles = useThemedStyles(filePreviewStyles)
  return (
    <Text style={[styles.truncatedNote, style]}>
      Preview truncated: showing the first {DESKTOP_TEXT_READ_CAP} of the file.
    </Text>
  )
}
