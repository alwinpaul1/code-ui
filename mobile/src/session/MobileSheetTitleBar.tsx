import { X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** A sheet's top row as the Claude app draws it: a close cross on the left
 *  and the title centred across the whole width (2026-09-24 recordings). */
export function MobileSheetTitleBar({ title, onClose }: { title: string; onClose?: () => void }) {
  const { colors, space } = useTheme()
  return (
    <View style={{ minHeight: 44, justifyContent: 'center', marginBottom: space.sm }}>
      <Txt variant="heading" weight="semibold" align="center" numberOfLines={1} style={{ marginHorizontal: 44 }}>
        {title}
      </Txt>
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            position: 'absolute',
            left: 0,
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1
          })}
        >
          <X size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  )
}
