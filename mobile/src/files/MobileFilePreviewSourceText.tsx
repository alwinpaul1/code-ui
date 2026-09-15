import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, Text, type StyleProp, type TextStyle } from 'react-native'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { formatPreviewByteLength } from './mobile-file-preview-request'
import { scrollOffsetForPreviewLine } from './mobile-file-preview-line-column'
import { buildMobileFilePreviewSyntax } from './mobile-file-preview-syntax'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

export function MobileFilePreviewSourceText({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine
}: {
  relativePath: string
  content: string
  truncated?: boolean
  byteLength?: number
  initialLine?: number
}) {
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
      {truncated ? (
        <MobileFilePreviewTruncatedNote byteLength={byteLength ?? content.length} />
      ) : null}
      <Text selectable style={styles.textPreview} accessibilityLabel="File preview">
        <MobileSyntaxSegments segments={syntax.segments} />
      </Text>
    </ScrollView>
  )
}

export function MobileFilePreviewTruncatedNote({
  byteLength,
  // Why: the markdown preview draws this note over a themed surface, so it
  // hands in its own colour. It layers over the shared one rather than
  // replacing it, so a field added below still reaches every caller.
  style
}: {
  byteLength: number
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text style={[styles.truncatedNote, style]}>
      Preview truncated. File size: {formatPreviewByteLength(byteLength)}.
    </Text>
  )
}
