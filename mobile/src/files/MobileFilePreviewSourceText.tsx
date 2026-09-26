import { useMemo } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { MobileCodeView } from '../components/MobileCodeView'
import { buildMobileCodeDocument } from '../components/mobile-code-document'
import { resolveMobileSyntaxLanguageForContent } from '../session/mobile-file-syntax'
import { REFORMATTED_JSON_NOTICE } from '../components/mobile-code-notices'
import { formatPreviewByteLength } from './mobile-file-preview-response'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

/** A text file opened from the explorer, in the code viewer: numbered lines,
 *  indent guides, the theme's code colours, no wrapping. It used to be one
 *  selectable Text holding the whole file (2026-09-26). */
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
  const document = useMemo(
    () => buildMobileCodeDocument(content, resolveMobileSyntaxLanguageForContent(relativePath, content)),
    [content, relativePath]
  )
  const notice = truncated
    ? previewTruncatedText(byteLength ?? content.length)
    : document.reformatted
      ? REFORMATTED_JSON_NOTICE
      : null
  return (
    <MobileCodeView
      document={document}
      accessibilityLabel="File preview"
      initialLine={initialLine}
      notice={notice}
    />
  )
}

function previewTruncatedText(byteLength: number): string {
  return `Preview truncated. File size: ${formatPreviewByteLength(byteLength)}.`
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
    <Text style={[styles.truncatedNote, style]}>{previewTruncatedText(byteLength)}</Text>
  )
}
