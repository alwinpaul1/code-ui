import { Pressable, View } from 'react-native'
import { Copy, X } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/**
 * Floating bar over the file reader while a line selection is active (VS
 * Code's Alt+K parity): reference just the selected lines, or the whole file
 * instead, without leaving the reader. Themed through `useTheme()` so it
 * reads correctly in both light and dark — see theme-context.ts.
 *
 * With no range (a pretty-printed JSON file, whose line numbers are not the
 * file's) it offers the whole file alone: that file was otherwise left with
 * no way to be asked about (2026-09-26). The explorer, which has no chat to
 * ask, uses the same bar to copy the selected lines (range "Copy lines …").
 */
export function MobileSessionFileReaderLineActionBar({
  range,
  onAskAboutFile,
  copy,
  onDismiss
}: {
  /** "Ask about lines 10–20" (fileReaderLineSelectionLabel) or "Copy lines
   *  10–20", and what it does; absent where the lines cannot be referenced. */
  range?: { label: string; onPress: () => void }
  onAskAboutFile?: () => void
  /** Copies the selected lines, beside the ask actions ("Copy lines 10–20"). */
  copy?: { label: string; onPress: () => void }
  onDismiss: () => void
}) {
  const { colors, space, radius, type } = useTheme()
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingHorizontal: space.md,
        paddingBottom: space.lg
      }}
    >
      <View
        testID="file-reader-line-action-bar"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          maxWidth: '100%',
          backgroundColor: colors.bgPanelGlass,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.xl,
          paddingVertical: space.xs,
          paddingLeft: space.md,
          paddingRight: space.xs,
          shadowColor: colors.shadow,
          shadowOpacity: 1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6
        }}
      >
        {range ? (
          <Pressable
            onPress={range.onPress}
            accessibilityRole="button"
            accessibilityLabel={range.label}
            hitSlop={6}
            style={{ paddingVertical: space.sm, flexShrink: 1 }}
          >
            <Txt variant="label" weight="semibold" numberOfLines={1}>
              {range.label}
            </Txt>
          </Pressable>
        ) : null}
        {range && onAskAboutFile ? (
          <View
            style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: space.xs }}
          />
        ) : null}
        {onAskAboutFile ? (
          <Pressable
            onPress={onAskAboutFile}
            accessibilityRole="button"
            accessibilityLabel="Ask about file"
            hitSlop={6}
            style={{ paddingVertical: space.sm, paddingHorizontal: range ? space.sm : 0 }}
          >
            <Txt
              variant="label"
              tone={range ? 'secondary' : undefined}
              weight={range ? undefined : 'semibold'}
              numberOfLines={1}
            >
              Ask about file
            </Txt>
          </Pressable>
        ) : null}
        {copy ? (
          <Pressable
            onPress={copy.onPress}
            accessibilityRole="button"
            accessibilityLabel={copy.label}
            hitSlop={8}
            style={{ padding: space.xs }}
          >
            <Copy size={type.label.size} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Cancel line selection"
          hitSlop={8}
          style={{ padding: space.xs }}
        >
          <X size={type.label.size} color={colors.textSecondary} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  )
}
