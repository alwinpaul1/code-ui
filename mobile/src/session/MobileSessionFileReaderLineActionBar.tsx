import { Pressable, View } from 'react-native'
import { X } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/**
 * Floating bar over the file reader while a line selection is active (VS
 * Code's Alt+K parity): reference just the selected lines, or the whole file
 * instead, without leaving the reader. Themed through `useTheme()` so it
 * reads correctly in both light and dark — see theme-context.ts.
 */
export function MobileSessionFileReaderLineActionBar({
  label,
  onAskAboutLines,
  onAskAboutFile,
  onDismiss
}: {
  /** "Ask about line 10" or "Ask about lines 10–20" (fileReaderLineSelectionLabel). */
  label: string
  onAskAboutLines: () => void
  onAskAboutFile: () => void
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
        <Pressable
          onPress={onAskAboutLines}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={6}
          style={{ paddingVertical: space.sm, flexShrink: 1 }}
        >
          <Txt variant="label" weight="semibold" numberOfLines={1}>
            {label}
          </Txt>
        </Pressable>
        <View
          style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: space.xs }}
        />
        <Pressable
          onPress={onAskAboutFile}
          accessibilityRole="button"
          accessibilityLabel="Ask about file"
          hitSlop={6}
          style={{ paddingVertical: space.sm, paddingHorizontal: space.sm }}
        >
          <Txt variant="label" tone="secondary" numberOfLines={1}>
            Ask about file
          </Txt>
        </Pressable>
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
