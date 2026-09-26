import { useMemo } from 'react'
import { Text, View, type StyleProp, type TextStyle } from 'react-native'
import { MobileCodeView } from '../components/MobileCodeView'
import { buildMobileCodeDocument } from '../components/mobile-code-document'
import { useMobileSyntaxLanguage } from '../session/use-mobile-syntax-language'
import { previewTruncatedText, REFORMATTED_JSON_NOTICE } from '../components/mobile-code-notices'
import { useCodeLineSelection } from '../components/use-code-line-selection'
import { copyFailedNotice, useCopyToClipboard } from '../components/use-copy-to-clipboard'
import {
  fileReaderLineCopyLabel,
  fileReaderSelectedLinesText
} from '../session/mobile-file-reader-line-selection'
import { MobileSessionFileReaderLineActionBar } from '../session/MobileSessionFileReaderLineActionBar'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

/**
 * A text file opened from the explorer, in the code viewer: numbered lines,
 * indent guides, the theme's code colours, no wrapping. It used to be one
 * selectable Text holding the whole file, so the OS selection could run over
 * any block; one Text per row ends a selection at the row's end
 * (2026-09-26). So, as on the desktop, a block is selected by lines
 * (long-press one, tap another) and copied from the bar, and the toolbar
 * copies the whole file.
 */
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
  const language = useMobileSyntaxLanguage(relativePath, content)
  const document = useMemo(() => buildMobileCodeDocument(content, language), [content, language])
  const selection = useCodeLineSelection({
    canOpen: content.length > 0,
    canRange: true,
    resetKey: relativePath
  })
  const linesCopy = useCopyToClipboard()
  const { range, clear } = selection
  const notice = linesCopy.error
    ? copyFailedNotice(linesCopy.error)
    : truncated
      ? previewTruncatedText(byteLength ?? content.length)
      : document.reformatted
        ? REFORMATTED_JSON_NOTICE
        : null
  return (
    <View style={styles.sourceArea}>
      <MobileCodeView
        document={document}
        accessibilityLabel="File preview"
        initialLine={initialLine}
        notice={notice}
        lineProps={selection.lineProps}
        extraData={selection.extraData}
        copyText={content}
        copyLoadedOnly={truncated === true}
      />
      {range ? (
        <MobileSessionFileReaderLineActionBar
          range={{
            label: fileReaderLineCopyLabel(range),
            onPress: () => {
              void linesCopy.copy(fileReaderSelectedLinesText(document.lines, range)).then((copied) => {
                if (copied) {
                  clear()
                }
              })
            }
          }}
          onDismiss={clear}
        />
      ) : null}
    </View>
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
    <Text style={[styles.truncatedNote, style]}>{previewTruncatedText(byteLength)}</Text>
  )
}
