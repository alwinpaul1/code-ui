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
 * sheet is dragged to its top). Not `fillAvailable`: that lifts the box by the
 * keyboard, and a full-height box cannot be lifted, so with the composer's
 * keyboard still up the top of the sheet stood off the screen. The drawer's
 * motion is unchanged (0.9.139).
 *
 * Known, unproven on a device: a Modal's touches reach its React ancestors, so
 * a block drawn inside a pressable bubble (a lead agent's prompt drawn as
 * Markdown, MobileNativeChatMessage's Bubble) may see taps made in this sheet.
 */
export function MarkdownCodeSheet({
  visible,
  language,
  code,
  onClose,
  onAfterClose
}: {
  visible: boolean
  language: string | undefined
  code: string
  onClose: () => void
  /** The sheet has left the screen; the caller may let go of it. */
  onAfterClose?: () => void
}) {
  const { colors, space } = useTheme()
  const styles = useMarkdownStyles()
  const { copied, error, copy } = useCopyToClipboard(CODE_BLOCK_SPEC.copy.copiedMs)
  // Highlighted once per source. Not only while `visible`: the cross flips it
  // at once and the drawer plays its exit, which would play over an empty
  // body. The caller lets the sheet go once it has left (`onAfterClose`).
  const lines = useMemo(() => mobileMarkdownCodeLines(code, language, Infinity).lines, [code, language])
  const { sheetButton } = CODE_BLOCK_SPEC
  const glyphColor = sheetColors(colors).content
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={onAfterClose}
      expandable
      openingShare={1}
      contentScrollable={false}
      // The code fill runs the sheet's whole width, as the app's does.
      edgeToEdge
      // Nothing to type here: the keyboard behind the composer goes as the
      // sheet opens, instead of lifting the sheet above it.
      dismissKeyboardOnOpen
      header={
        // The cross and Copy sit 8 dp further in than the drawer's own padding,
        // as in the Claude app's other sheets; edge to edge, that is both.
        <View style={{ paddingHorizontal: space.md + space.sm }}>
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
