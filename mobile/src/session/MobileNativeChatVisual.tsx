import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Maximize2, X } from 'lucide-react-native'
import type { NativeChatVisualDirective } from '../../../src/shared/native-chat-visual-directive'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import type { MobileNativeChatVisualSource } from './mobile-native-chat-visual-read'
import { MOBILE_NATIVE_CHAT_VISUAL_INITIAL_HEIGHT } from './mobile-native-chat-visual-host-document'
import { MobileNativeChatVisualFrame } from './MobileNativeChatVisualFrame'
import { useMobileNativeChatVisual } from './use-mobile-native-chat-visual'
import {
  MobileNativeChatVisualContext,
  type MobileNativeChatVisualRender
} from './mobile-native-chat-visual-context'

const DEFAULT_TITLE = 'Visualization'
const UNAVAILABLE = 'Visualization unavailable'

/** The quiet reserved space a visual takes while it loads. */
function MobileNativeChatVisualPlaceholder({ styles }: { styles: VisualStyles }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.frame, styles.placeholder]}>
      <ActivityIndicator size="small" color={colors.textMuted} />
    </View>
  )
}

/** The transcript's visual renderer for a structured chat's source; null without one. */
export function useMobileNativeChatVisualRenderer(
  source: MobileNativeChatVisualSource | null
): MobileNativeChatVisualRender | null {
  return useMemo(
    () =>
      source
        ? (directive) => <MobileNativeChatVisual directive={directive} source={source} />
        : null,
    [source]
  )
}

/** Hands the transcript under it the renderer for a structured chat's inline visuals; with no
 *  source (no structured chat, no client) the rows leave `::orca-visual` lines as text. */
export function MobileNativeChatVisualProvider({
  source,
  children
}: {
  source: MobileNativeChatVisualSource | null
  children: ReactNode
}) {
  const visuals = useMobileNativeChatVisualRenderer(source)
  return <MobileNativeChatVisualContext.Provider value={visuals}>{children}</MobileNativeChatVisualContext.Provider>
}

/** A `::orca-visual{...}` line in an assistant reply, rendered from the chat's host (Orca #26071).
 *  Drawn between the reply's prose runs, in the app's own light or dark theme. */
export const MobileNativeChatVisual = memo(function MobileNativeChatVisual({
  directive,
  source
}: {
  directive: NativeChatVisualDirective
  source: MobileNativeChatVisualSource
}) {
  const styles = useThemedStyles(visualStyles)
  const { colors } = useTheme()
  const { state, retry } = useMobileNativeChatVisual(source, directive.file)
  // A frame that navigated away or kept crashing; cleared by the reader's retry.
  const [frameFailed, setFrameFailed] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const title = directive.title ?? DEFAULT_TITLE
  const onFrameFailed = useCallback(() => {
    setFrameFailed(true)
    setFullscreen(false)
  }, [])
  const onRetry = useCallback(() => {
    setFrameFailed(false)
    retry()
  }, [retry])
  const closeFullscreen = useCallback(() => setFullscreen(false), [])

  if (state.kind === 'loading') {
    return <MobileNativeChatVisualPlaceholder styles={styles} />
  }
  if (state.kind === 'unsupported') {
    // An Orca that cannot serve visuals: no tap would change it, so nothing here is a control.
    return (
      <View style={styles.unavailable} accessibilityLabel={UNAVAILABLE}>
        <Text style={styles.unavailableText}>{UNAVAILABLE}</Text>
      </View>
    )
  }
  if (state.kind === 'unavailable' || frameFailed) {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={UNAVAILABLE}
        accessibilityHint="Tries to load it again"
        style={styles.unavailable}
      >
        <Text style={styles.unavailableText}>{UNAVAILABLE}</Text>
      </Pressable>
    )
  }
  return (
    <View style={styles.frame}>
      <MobileNativeChatVisualFrame html={state.html} title={title} mode="inline" onFailed={onFrameFailed} />
      <Pressable
        onPress={() => setFullscreen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${title} full screen`}
        hitSlop={8}
        style={styles.openButton}
      >
        <Maximize2 size={14} color={colors.textSecondary} strokeWidth={2.2} />
      </Pressable>
      {fullscreen ? (
        <MobileNativeChatVisualFullscreen
          html={state.html}
          title={title}
          onClose={closeFullscreen}
          onFailed={onFrameFailed}
          styles={styles}
        />
      ) : null}
    </View>
  )
})

function MobileNativeChatVisualFullscreen({
  html,
  title,
  onClose,
  onFailed,
  styles
}: {
  html: string
  title: string
  onClose: () => void
  onFailed: () => void
  styles: VisualStyles
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            style={styles.closeButton}
          >
            <X size={18} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
        </View>
        <MobileNativeChatVisualFrame html={html} title={title} mode="fullscreen" onFailed={onFailed} />
      </View>
    </Modal>
  )
}

type VisualStyles = ReturnType<typeof visualStyles>

function visualStyles({ colors }: Theme) {
  return StyleSheet.create({
    frame: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.row,
      marginBottom: spacing.sm,
      overflow: 'hidden'
    },
    placeholder: {
      height: MOBILE_NATIVE_CHAT_VISUAL_INITIAL_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center'
    },
    unavailable: { marginBottom: spacing.sm, paddingVertical: spacing.xs },
    unavailableText: { color: colors.textMuted, fontSize: typography.metaSize },
    openButton: {
      position: 'absolute',
      top: spacing.xs,
      right: spacing.xs,
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgPanel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    sheet: { flex: 1, backgroundColor: colors.bg },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    sheetTitle: {
      flex: 1,
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    closeButton: { padding: spacing.xs }
  })
}
