import { memo, useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import { Maximize2 } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { CODE_BLOCK_SPEC, codeBlockLabel } from './code-block-spec'
import { CodeCopyGlyph, CodeIconButton, codeGlyphSize } from './MobileMarkdownCodeIconButton'
import { MarkdownCodeSheet } from './MobileMarkdownCodeSheet'
import { copyFailedNotice, useCopyToClipboard } from './use-copy-to-clipboard'
import type { MarkdownStyles } from './mobile-markdown-styles'

/**
 * The row above a fence's code, as the Claude app draws it (kso.java; the
 * numbers are in code-block-spec.ts): the language (or "Code") on the left,
 * Copy and Expand on the right. Expand opens the block in a sheet of its own
 * (MobileMarkdownCodeSheet.tsx).
 *
 * Copy came first, asked for from the device on 2026-09-29 ("Have a copy
 * button for code"). Holding a fence could not copy it: each run of lines is
 * its own selectable Text, so Android's selection stops at the end of one; a
 * line wider than the screen scrolls its end away from the handles; and past
 * MAX_MARKDOWN_CODE_LINES the rest is not drawn on the card at all. Copy
 * writes the fence's source instead, which none of that touches: every line,
 * no line numbers, and the newlines as written. A hold on the lines still
 * selects.
 *
 * A component of its own so a copy re-renders this row and not the fence's
 * lines, and memoised so a streaming message skips the headers of the blocks
 * that did not grow. The lines under it are still drawn again on every render.
 */
function MarkdownCodeHeaderInner({
  language,
  code,
  styles
}: {
  language: string | undefined
  /** The fence's source, exactly as the parser read it. */
  code: string
  styles: MarkdownStyles
}) {
  const { colors } = useTheme()
  const { copied, error, copy } = useCopyToClipboard(CODE_BLOCK_SPEC.copy.copiedMs)
  // The sheet is built the first time it is asked for and kept, so its close
  // has a drawer to animate, and a block nobody expands mounts none.
  const [sheet, setSheet] = useState<'never' | 'open' | 'closed'>('never')
  const openSheet = useCallback(() => setSheet('open'), [])
  const closeSheet = useCallback(() => setSheet('closed'), [])
  // An empty fence has nothing to copy (writing '' would empty whatever the
  // reader had on the clipboard) and nothing to expand.
  const hasCode = code.length > 0
  const { button } = CODE_BLOCK_SPEC
  return (
    <>
      <View style={styles.codeHeader} testID="markdown-code-header">
        <Text style={styles.codeLabel} numberOfLines={1} testID="markdown-code-label">
          {codeBlockLabel(language)}
        </Text>
        {hasCode ? (
          <View style={styles.codeHeaderActions}>
            <CodeIconButton
              label={copied ? 'Copied' : 'Copy code'}
              onPress={() => void copy(code)}
              sizeSp={button.sizeSp}
              touchTargetDp={button.touchTargetDp}
            >
              <CodeCopyGlyph
                copied={copied}
                glyphSp={button.glyphSp}
                color={colors.codeBlockLabel}
                copiedColor={colors.codeBlockCopied}
              />
            </CodeIconButton>
            <CodeIconButton
              label="Expand code"
              onPress={openSheet}
              sizeSp={button.sizeSp}
              touchTargetDp={button.touchTargetDp}
            >
              <Maximize2 size={codeGlyphSize(button.glyphSp)} color={colors.codeBlockLabel} strokeWidth={2} />
            </CodeIconButton>
          </View>
        ) : null}
      </View>
      {error ? <Text style={styles.codeCopyFailed}>{copyFailedNotice(error)}</Text> : null}
      {sheet === 'never' ? null : (
        <MarkdownCodeSheet visible={sheet === 'open'} language={language} code={code} onClose={closeSheet} />
      )}
    </>
  )
}

export const MarkdownCodeHeader = memo(MarkdownCodeHeaderInner)
