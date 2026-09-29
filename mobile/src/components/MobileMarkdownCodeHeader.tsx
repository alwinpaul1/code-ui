import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check, Copy } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { copyFailedNotice, useCopyToClipboard } from './use-copy-to-clipboard'
import { MARKDOWN_CODE_COPY_ICON_SIZE, type MarkdownStyles } from './mobile-markdown-styles'

/**
 * The row above a fence's code: its language on the left and Copy on the
 * right, where the Claude app puts them.
 *
 * Asked for from the device on 2026-09-29 ("Have a copy button for code").
 * Holding a fence could not copy it: each line is its own selectable Text, so
 * Android's selection stops at the end of one line; a line wider than the
 * screen scrolls its end away from the handles; and past
 * MAX_MARKDOWN_CODE_LINES the rest is not drawn at all. This copies the
 * fence's source instead, which none of that touches: every line, no line
 * numbers, and the newlines as written. A hold on the lines still selects.
 *
 * A component of its own so a copy re-renders this row and not the fence's
 * lines, and memoised so a streaming message skips the headers of the blocks
 * that did not grow. The lines under it are still drawn again on every render.
 */
function MarkdownCodeHeaderInner({
  language,
  code,
  closed,
  styles
}: {
  language: string | undefined
  /** The fence's source, exactly as the parser read it. */
  code: string
  /** The fence has its closing run: nothing more will stream into it. */
  closed: boolean
  styles: MarkdownStyles
}) {
  const { colors } = useTheme()
  const { copied, error, copy } = useCopyToClipboard()
  // A finished empty fence with no language has nothing to put here. One
  // still streaming keeps its row, so the first character does not push the
  // code down when it brings the button in.
  if (closed && !language && code.length === 0) {
    return null
  }
  return (
    <>
      <View style={styles.codeHeader} testID="markdown-code-header">
        {language ? (
          <Text style={styles.codeLanguage} numberOfLines={1}>
            {language}
          </Text>
        ) : null}
        {/* An empty fence has nothing to copy, and writing '' would empty
            whatever the reader had on the clipboard. */}
        {code.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.codeCopy, pressed ? styles.codeCopyPressed : null]}
            onPress={() => copy(code)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? (
              <>
                <Check size={MARKDOWN_CODE_COPY_ICON_SIZE} color={colors.accent} strokeWidth={2.2} />
                <Text style={styles.codeCopied}>Copied</Text>
              </>
            ) : (
              <Copy size={MARKDOWN_CODE_COPY_ICON_SIZE} color={colors.textMuted} strokeWidth={2} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.codeCopyFailed}>{copyFailedNotice(error)}</Text> : null}
    </>
  )
}

export const MarkdownCodeHeader = memo(MarkdownCodeHeaderInner)
