import { useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native'
import { Eye, Pencil, RefreshCw } from 'lucide-react-native'
import { MobileRichMarkdownEditor } from '../components/MobileRichMarkdownEditor'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { resolveMarkdownFloatingActionsBottom } from './markdown-floating-actions-layout'
import { spacing } from '../theme/mobile-theme'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import { sessionStyles } from './mobile-session-styles'
import type { MarkdownDocState } from './mobile-session-route-types'
import { markdownReadOnlyStatus, markdownSaveErrorStatus } from './mobile-markdown-disk-fallback'
import { useScrollReadingPosition } from '../files/use-reading-position'
import type { MarkdownImageResolver } from '../components/markdown-image-source'

/**
 * Reading and writing are two different jobs, and the tab only ever offered the
 * second one: it opened straight into the WYSIWYG editor, with a formatting
 * toolbar across the top, whether or not anyone meant to type. Asked for on
 * 2026-09-15 — "where is the preview and the edit toggle i only need 2".
 *
 * Preview is the default because opening a document is usually reading it, and
 * it draws through `MobileMarkdown`, the same renderer the chat and the file
 * preview use — so a fenced block gets its scroller, a mermaid fence gets its
 * diagram, and a file path stays tappable. Edit hands over to the WebView.
 *
 * The whole reader — its page, the toggle bar, the loading spinner, a read
 * error, the Retry button and the floating Copy/Refresh/Discard/Save bar —
 * paints from the live theme (`sessionStyles`, through `useThemedStyles`).
 * The one static-dark island left on purpose is the WYSIWYG editor's own
 * WebView chrome, which is a separate component's pass.
 */
type MarkdownViewMode = 'preview' | 'edit'

export function MarkdownReader({
  documentId,
  doc,
  onRefresh,
  onChange,
  onSave,
  onCopy,
  onDiscard,
  keyboardLift,
  readingPositionKey = null,
  resolveImage
}: {
  documentId: string
  doc: MarkdownDocState | undefined
  /** Names the document across opens, so Preview scrolls back to where the
   *  reader left it. */
  readingPositionKey?: string | null
  /** Reads the document's images off the host for Preview. */
  resolveImage?: MarkdownImageResolver
  onRefresh: () => void
  onChange: (content: string) => void
  onSave: () => void
  onCopy: () => void
  onDiscard: () => void
  keyboardLift: number
}) {
  // Native Keyboard events under-report the WebView editor's covered area, so prefer the larger WebView-measured inset.
  const [webviewKeyboardInset, setWebviewKeyboardInset] = useState(0)
  const [mode, setMode] = useState<MarkdownViewMode>('preview')
  const readingScroll = useScrollReadingPosition(readingPositionKey)
  const { colors } = useTheme()
  const styles = useThemedStyles(sessionStyles)
  const modeStyles = useThemedStyles(markdownModeStyles)
  const effectiveKeyboardLift = Math.max(keyboardLift, webviewKeyboardInset)
  if (!doc || doc.status === 'loading') {
    return (
      <View style={styles.markdownState}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (doc.status === 'error') {
    return (
      <View style={styles.markdownState}>
        <Text style={styles.markdownError}>{doc.message}</Text>
        <Pressable style={styles.markdownRefreshButton} onPress={onRefresh}>
          <RefreshCw size={14} color={colors.text} />
          <Text style={styles.markdownRefreshText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const statusText = doc.saveError
    ? markdownSaveErrorStatus(doc.saveError)
    : doc.readOnlyReason
      ? markdownReadOnlyStatus(doc.readOnlyReason)
      : doc.stale
        ? 'Changed on desktop'
        : null
  const showRefresh = (doc.stale && !doc.isDirty) || !doc.editable
  const showCopy = doc.saveError || !doc.editable
  const showSave = doc.isDirty || doc.saving
  const showFloatingActions = statusText || showRefresh || showCopy || showSave

  return (
    <View style={styles.markdownEditor}>
      <View style={modeStyles.bar}>
        {(['preview', 'edit'] as const).map((option) => {
          const selected = mode === option
          const Icon = option === 'preview' ? Eye : Pencil
          return (
            <Pressable
              key={option}
              style={[modeStyles.toggle, selected ? modeStyles.toggleActive : null]}
              onPress={() => setMode(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option === 'preview' ? 'Preview Markdown' : 'Edit Markdown'}
            >
              <Icon
                size={14}
                color={selected ? colors.text : colors.textSecondary}
                strokeWidth={2.2}
              />
              <Text style={[modeStyles.label, selected ? modeStyles.labelActive : null]}>
                {option === 'preview' ? 'Preview' : 'Edit'}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {mode === 'preview' ? (
        // Unmounting the editor is deliberate: two live copies of one document
        // would both answer onChange, and the WebView keeps its own undo stack.
        <ScrollView
          {...readingScroll}
          style={modeStyles.previewScroll}
          contentContainerStyle={modeStyles.preview}
        >
          <MobileMarkdown
            content={doc.localContent}
            fallback="This file is empty."
            resolveImage={resolveImage}
          />
        </ScrollView>
      ) : (
        <MobileRichMarkdownEditor
          key={documentId}
          content={doc.localContent}
          editable={doc.editable && !doc.saving}
          onChange={onChange}
          onKeyboardInsetChange={setWebviewKeyboardInset}
        />
      )}
      {showFloatingActions ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.markdownFloatingBar,
            // Why: editor focus lives in a WebView, so lift native Save/Discard controls instead of resizing it.
            {
              bottom: resolveMarkdownFloatingActionsBottom({
                keyboardLift: effectiveKeyboardLift,
                restingBottom: spacing.lg,
                liftedClearance: spacing.md
              })
            }
          ]}
        >
          {statusText ? (
            <Text
              style={[styles.markdownFloatingStatus, doc.saveError ? styles.markdownError : null]}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          ) : null}
          <View style={styles.markdownFloatingActions}>
            {showCopy ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onCopy}>
                <Text style={styles.markdownFloatingButtonText}>Copy</Text>
              </Pressable>
            ) : null}
            {showRefresh ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onRefresh}>
                <RefreshCw size={13} color={colors.text} />
                <Text style={styles.markdownFloatingButtonText}>Refresh</Text>
              </Pressable>
            ) : null}
            {doc.isDirty ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onDiscard}>
                <Text style={styles.markdownFloatingButtonText}>Discard</Text>
              </Pressable>
            ) : null}
            {showSave ? (
              <Pressable
                style={[
                  styles.markdownFloatingButton,
                  styles.markdownSaveButton,
                  (!doc.editable || !doc.isDirty || doc.saving) && styles.markdownButtonDisabled
                ]}
                disabled={!doc.editable || !doc.isDirty || doc.saving}
                onPress={onSave}
              >
                {doc.saving ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.markdownFloatingButtonText}>Save</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

/** The mode toggle bar: new UI with no legacy counterpart in `mobile-session-styles`, so it keeps
 *  its own small themed factory rather than growing the shared one for a single caller. */
function markdownModeStyles({ colors, radius, space, type }: Theme) {
  return {
    bar: {
      flexDirection: 'row' as const,
      alignSelf: 'flex-start' as const,
      gap: 2,
      margin: space.sm,
      padding: 2,
      borderRadius: radius.sm,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    toggle: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: space.xs,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.xs
    },
    toggleActive: {
      backgroundColor: colors.bgRaised
    },
    label: {
      fontSize: type.caption.size,
      color: colors.textSecondary
    },
    labelActive: {
      color: colors.text
    },
    previewScroll: {
      flex: 1,
      backgroundColor: colors.bg
    },
    preview: {
      paddingHorizontal: space.md,
      paddingBottom: space.xl
    }
  }
}
