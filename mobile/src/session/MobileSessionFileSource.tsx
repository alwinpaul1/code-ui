import { useMemo } from 'react'
import { View } from 'react-native'
import { MobileCodeView } from '../components/MobileCodeView'
import { buildMobileCodeDocument } from '../components/mobile-code-document'
import { previewTruncatedText, REFORMATTED_JSON_NOTICE } from '../components/mobile-code-notices'
import { useCodeFolding } from '../components/use-code-folding'
import { useCodeLineSelection } from '../components/use-code-line-selection'
import { copyFailedNotice, useCopyToClipboard } from '../components/use-copy-to-clipboard'
import { useMobileSyntaxLanguage } from './use-mobile-syntax-language'
import {
  fileReaderLineCopyLabel,
  fileReaderLineSelectionLabel,
  fileReaderSelectedLinesText,
  type FileReaderLineRange
} from './mobile-file-reader-line-selection'
import { MobileSessionFileReaderLineActionBar } from './MobileSessionFileReaderLineActionBar'
import { styles } from './mobile-session-styles'

/**
 * A file tab's source, in the code viewer, with the reader's line selection
 * (Alt+K parity: long-press a line, tap another to extend, ask the chat
 * about them, or copy them).
 */
export function MobileSessionFileSource({
  content,
  language,
  title,
  relativePath,
  onAskAboutLines,
  truncated = false,
  byteLength
}: {
  content: string
  /** The highlighter's language by name (resolveMobileSyntaxLanguage); a
   *  plaintext one is checked against the content when the name is unknown. */
  language: string
  title: string
  relativePath: string
  onAskAboutLines?: (range: FileReaderLineRange | null) => void
  /** The host sent only part of the file: say so, and copy only what came. */
  truncated?: boolean
  byteLength?: number
}) {
  // A file whose name says nothing (`bin/deploy`) is read for its language,
  // a tick after it is drawn.
  const syntaxLanguage = useMobileSyntaxLanguage(relativePath || title, content, language)
  const document = useMemo(() => buildMobileCodeDocument(content, syntaxLanguage), [content, syntaxLanguage])
  // An empty file has nothing to ask about. A pretty-printed JSON file's line
  // numbers are not the file's, so a range from it would point the agent at
  // lines that do not exist: a long-press there opens the bar for the whole
  // file alone, with no range and nothing highlighted.
  const canAsk = onAskAboutLines != null && content.length > 0
  const folding = useCodeFolding(document)
  const selection = useCodeLineSelection({
    canOpen: canAsk,
    canRange: canAsk && !document.reformatted,
    resetKey: relativePath,
    coverRange: folding.coverFolds,
    shownLine: folding.shownLine
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
    <View style={styles.markdownEditor}>
      <MobileCodeView
        document={document}
        accessibilityLabel={`${title} preview`}
        notice={notice}
        lineProps={selection.lineProps}
        extraData={selection.extraData}
        folding={folding}
        copyText={content}
        copyLoadedOnly={truncated}
      />
      {selection.open ? (
        <MobileSessionFileReaderLineActionBar
          range={
            range
              ? {
                  label: fileReaderLineSelectionLabel(range),
                  onPress: () => {
                    clear()
                    onAskAboutLines?.(range)
                  }
                }
              : undefined
          }
          onAskAboutFile={() => {
            clear()
            onAskAboutLines?.(null)
          }}
          copy={
            range
              ? {
                  label: fileReaderLineCopyLabel(range),
                  onPress: () => {
                    void linesCopy.copy(fileReaderSelectedLinesText(document.lines, range, document.lineBreak)).then((copied) => {
                      if (copied) {
                        clear()
                      }
                    })
                  }
                }
              : undefined
          }
          onDismiss={clear}
        />
      ) : null}
    </View>
  )
}
