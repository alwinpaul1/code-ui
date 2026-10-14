import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MobileSheetTitleBar } from '../session/MobileSheetTitleBar'
import { useTheme } from '../theme/theme-context'
import { BottomDrawer } from './BottomDrawer'
import { CODE_BLOCK_SPEC, codeBlockSheetTitle } from './code-block-spec'
import { CodeCopyGlyph, CodeIconButton } from './MobileMarkdownCodeIconButton'
import { MarkdownCodeText } from './MobileMarkdownCodeText'
import { mobileMarkdownCodeLines } from './mobile-markdown-code-lines'
import { useMarkdownStyles } from './mobile-markdown-styles'
import { sheetColors } from './sheet-spec'
import { copyFailedNotice, useCopyToClipboard } from './use-copy-to-clipboard'

/**
 * What Expand on a code block opens: the block in a sheet of its own, as the
 * Claude app's `g130.g` shows it. A close cross on the left, the title over the
 * middle ("Code", or "Python code" over a fence that names a language) and
 * Copy on the right; under them the code full width on the code fill, one line
 * per source line, scrolling sideways, and down when it is longer than the
 * screen. Every line is drawn here: the card leaves out those past
 * MAX_MARKDOWN_CODE_LINES, and this is where they are read.
 *
 * The app's sheet is `LargeResizable` (wt10.java:G): it has a partial stop, so
 * it draws the grabber, and it opens large. That is the drawer's `expandable`
 * mode opened at full height, with its content static so the code owns its
 * own two scrolls instead of the drawer's list (which stands still until the
 * sheet is dragged to its top). The drawer's motion is unchanged (0.9.139).
 */
export function MarkdownCodeSheet({
  visible,
  language,
  code,
  onClose
}: {
  visible: boolean
  language: string | undefined
  code: string
  onClose: () => void
}) {
  const { colors, space } = useTheme()
  const styles = useMarkdownStyles()
  const { copied, error, copy } = useCopyToClipboard(CODE_BLOCK_SPEC.copy.copiedMs)
  // Highlighted once per source, and only while the sheet is up.
  const lines = useMemo(
    () => (visible ? mobileMarkdownCodeLines(code, language, Infinity).lines : []),
    [visible, code, language]
  )
  const { sheetButton } = CODE_BLOCK_SPEC
  const glyphColor = sheetColors(colors).content
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      expandable
      openingShare={1}
      fillAvailable
      contentScrollable={false}
      // Nothing to type here: the keyboard behind the composer goes as the
      // sheet opens, instead of lifting the sheet above it.
      dismissKeyboardOnOpen
      header={
        // The cross and Copy sit 8 dp further in than the drawer's edge, as in
        // the Claude app's other sheets.
        <View style={{ paddingHorizontal: space.sm }}>
          <MobileSheetTitleBar
            title={codeBlockSheetTitle(language)}
            onClose={onClose}
            trailing={
              code.length > 0 ? (
                <CodeIconButton
                  label={copied ? 'Copied' : 'Copy to clipboard'}
                  onPress={() => void copy(code)}
                  sizeSp={sheetButton.sizeSp}
                  touchTargetDp={sheetButton.touchTargetDp}
                >
                  <CodeCopyGlyph
                    copied={copied}
                    glyphSp={sheetButton.glyphSp}
                    color={glyphColor}
                    copiedColor={colors.codeBlockCopied}
                  />
                </CodeIconButton>
              ) : null
            }
          />
        </View>
      }
    >
      <View style={[styles.codeBody, { flex: 1 }]} testID="markdown-code-sheet-body">
        {error ? <Text style={styles.codeCopyFailed}>{copyFailedNotice(error)}</Text> : null}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* A horizontal scroller, not a wrap, and the same bar the card shows. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            persistentScrollbar
            contentContainerStyle={{
              paddingHorizontal: CODE_BLOCK_SPEC.body.sheetPaddingHorizontal,
              paddingVertical: CODE_BLOCK_SPEC.body.sheetPaddingVertical
            }}
          >
            <MarkdownCodeText lines={lines} lineStyle={styles.codeText} selectable />
          </ScrollView>
        </ScrollView>
      </View>
    </BottomDrawer>
  )
}
