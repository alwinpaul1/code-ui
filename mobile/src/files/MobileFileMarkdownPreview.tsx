import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Code, Pencil } from 'lucide-react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import {
  MobileFilePreviewSourceText,
  MobileFilePreviewTruncatedNote
} from './MobileFilePreviewSourceText'
import { useScrollReadingPosition } from './use-reading-position'
import type { MarkdownImageResolver } from '../components/markdown-image-source'

type Props = {
  relativePath: string
  content: string
  truncated: boolean
  byteLength: number
  initialLine?: number
  /** Names the document across opens, so the rendered view scrolls back to
   *  where the reader left it, app restarts included. Without it the document
   *  opens at the top every time. */
  readingPositionKey?: string | null
  /** Reads an image the document names off the host, so it draws as the
   *  image. Without it images stay tappable links. */
  resolveImage?: MarkdownImageResolver
  /**
   * The raw file, drawn by the caller's own source view. The session file tab
   * lends its numbered, virtualized one — a single <Text> holding a 4000-line
   * file froze the UI thread (2026-09-13). Without it the shared preview text
   * below is used, which is what the file screen wants.
   */
  renderSource?: () => ReactNode
}

/**
 * A markdown file as a document, with a toggle back to the raw text.
 *
 * Ported from upstream Orca's mobile client, which had already built this. The
 * mode machine, the icons and the labels are upstream's; the palette is not —
 * upstream reads the static `colors` object, and in this fork that palette is
 * dark-only while the rendered document below the toolbar already follows the
 * appearance setting. So the chrome is built from `useTheme()` instead, or
 * anyone on Light gets dark chrome over a light page.
 */
export function MobileFileMarkdownPreview({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine,
  readingPositionKey = null,
  resolveImage,
  renderSource
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(markdownPreviewStyles)
  const readingScroll = useScrollReadingPosition(readingPositionKey)
  const [mode, setMode] = useState<'preview' | 'source'>(() => (initialLine ? 'source' : 'preview'))
  const [previousRelativePath, setPreviousRelativePath] = useState(relativePath)
  const [previousInitialLine, setPreviousInitialLine] = useState(initialLine)
  // Why: opening a different file or line target must switch modes before paint,
  // never briefly retain the prior file's manually selected mode.
  if (relativePath !== previousRelativePath || initialLine !== previousInitialLine) {
    setPreviousRelativePath(relativePath)
    setPreviousInitialLine(initialLine)
    setMode(initialLine ? 'source' : 'preview')
  }
  const previewSelected = mode === 'preview'
  const sourceSelected = mode === 'source'

  return (
    <View style={styles.modeContainer}>
      <View style={styles.modeToolbar}>
        <Pressable
          style={[styles.modeToggle, sourceSelected && styles.modeToggleActive]}
          onPress={() => setMode('source')}
          accessibilityRole="button"
          accessibilityState={{ selected: sourceSelected }}
          accessibilityLabel="View Markdown source"
        >
          <Code
            size={15}
            color={sourceSelected ? colors.text : colors.textSecondary}
            strokeWidth={2.2}
          />
        </Pressable>
        <Pressable
          style={[styles.modeToggle, previewSelected && styles.modeToggleActive]}
          onPress={() => setMode('preview')}
          accessibilityRole="button"
          accessibilityState={{ selected: previewSelected }}
          accessibilityLabel="View rendered Markdown preview"
        >
          <Pencil
            size={15}
            color={previewSelected ? colors.text : colors.textSecondary}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>
      {mode === 'preview' ? (
        <ScrollView
          {...readingScroll}
          style={styles.scroll}
          contentContainerStyle={styles.markdownContent}
        >
          {truncated ? (
            <MobileFilePreviewTruncatedNote byteLength={byteLength} style={styles.truncatedNote} />
          ) : null}
          <MobileMarkdown content={content} resolveImage={resolveImage} />
        </ScrollView>
      ) : renderSource ? (
        renderSource()
      ) : (
        <MobileFilePreviewSourceText
          relativePath={relativePath}
          content={content}
          truncated={truncated}
          byteLength={byteLength}
          initialLine={initialLine}
        />
      )}
    </View>
  )
}

// The token values upstream's `filePreviewStyles` uses for these rows, read
// from the live theme instead of the legacy dark-only palette.
function markdownPreviewStyles({ colors, radius, space, type }: Theme) {
  return StyleSheet.create({
    modeContainer: {
      flex: 1,
      backgroundColor: colors.bg
    },
    modeToolbar: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      marginHorizontal: space.md,
      marginVertical: space.sm,
      padding: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.xs,
      backgroundColor: colors.bgPanel
    },
    modeToggle: {
      width: 34,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.xs,
      backgroundColor: 'transparent',
      opacity: 0.72
    },
    modeToggleActive: {
      backgroundColor: colors.bgRaised,
      opacity: 1
    },
    scroll: {
      flex: 1
    },
    markdownContent: {
      padding: space.md,
      paddingBottom: space.xl
    },
    truncatedNote: {
      marginBottom: space.md,
      color: colors.textSecondary,
      fontSize: type.caption.size
    }
  })
}
