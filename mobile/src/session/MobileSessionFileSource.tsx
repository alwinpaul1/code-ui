import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { MobileCodeView, type MobileCodeLineInteraction } from '../components/MobileCodeView'
import { buildMobileCodeDocument } from '../components/mobile-code-document'
import { resolveMobileSyntaxLanguageForContent } from './mobile-file-syntax'
import { REFORMATTED_JSON_NOTICE } from '../components/mobile-code-notices'
import { useTheme } from '../theme/theme-context'
import {
  extendFileReaderLineSelection,
  fileReaderLineSelectionLabel,
  fileReaderLineSelectionRange,
  isFileReaderLineSelected,
  startFileReaderLineSelection,
  type FileReaderLineRange,
  type FileReaderLineSelection
} from './mobile-file-reader-line-selection'
import { MobileSessionFileReaderLineActionBar } from './MobileSessionFileReaderLineActionBar'
import { styles } from './mobile-session-styles'

/**
 * A file tab's source, in the code viewer, with the reader's line selection
 * (Alt+K parity: long-press a line, tap another to extend, ask the chat
 * about them).
 */
export function MobileSessionFileSource({
  content,
  language,
  title,
  relativePath,
  onAskAboutLines
}: {
  content: string
  /** The highlighter's language by name (resolveMobileSyntaxLanguage); a
   *  plaintext one is checked against the content when the name is unknown. */
  language: string
  title: string
  relativePath: string
  onAskAboutLines?: (range: FileReaderLineRange | null) => void
}) {
  const { syntax } = useTheme()
  // A file whose name says nothing (`bin/deploy`) is read for its language.
  const document = useMemo(
    () => buildMobileCodeDocument(content, resolveMobileSyntaxLanguageForContent(relativePath || title, content, language)),
    [content, language, relativePath, title]
  )
  const [lineSelection, setLineSelection] = useState<FileReaderLineSelection>(null)
  // A freshly opened file starts with nothing selected — otherwise a
  // selection made on one file would appear to carry over onto the next.
  useEffect(() => {
    setLineSelection(null)
  }, [relativePath])
  const selectedRange = fileReaderLineSelectionRange(lineSelection)
  // The code palette's own fill: every code colour and the selected line's
  // number read on it at 4.5:1 in both schemes (syntax-palette.ts).
  const highlightStyle = useMemo(() => ({ backgroundColor: syntax.selection }), [syntax.selection])
  // An empty file has nothing to ask about. A pretty-printed JSON file's line
  // numbers are not the file's, so a range from it would point the agent at
  // lines that do not exist: no selection there either.
  const canSelectLines = onAskAboutLines != null && content.length > 0 && !document.reformatted
  const lineProps = useCallback(
    (lineNumber: number): MobileCodeLineInteraction => ({
      selectable: canSelectLines ? lineSelection === null : undefined,
      highlighted: isFileReaderLineSelected(lineSelection, lineNumber),
      highlightStyle,
      onLongPress: canSelectLines
        ? () => setLineSelection(startFileReaderLineSelection(lineNumber))
        : undefined,
      onPress:
        canSelectLines && lineSelection
          ? () => setLineSelection(extendFileReaderLineSelection(lineSelection, lineNumber))
          : undefined
    }),
    [canSelectLines, highlightStyle, lineSelection]
  )
  return (
    <View style={styles.markdownEditor}>
      <MobileCodeView
        document={document}
        accessibilityLabel={`${title} preview`}
        notice={document.reformatted ? REFORMATTED_JSON_NOTICE : null}
        lineProps={lineProps}
        extraData={lineSelection}
      />
      {canSelectLines && selectedRange ? (
        <MobileSessionFileReaderLineActionBar
          label={fileReaderLineSelectionLabel(selectedRange)}
          onAskAboutLines={() => {
            setLineSelection(null)
            onAskAboutLines?.(selectedRange)
          }}
          onAskAboutFile={() => {
            setLineSelection(null)
            onAskAboutLines?.(null)
          }}
          onDismiss={() => setLineSelection(null)}
        />
      ) : null}
    </View>
  )
}
