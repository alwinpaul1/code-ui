import { X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** The larger face of a title that wraps, against the heading size. */
const WRAPPED_TITLE_SCALE = 1.25

/** A sheet's top row as the Claude app draws it: a close cross on the left
 *  and the title centred across the whole width (2026-09-24 recordings).
 *  `wrap` is the run sheet's title: a whole sentence ("Ran 3 commands (2
 *  failed), / used 2 tools, created a file"), bold and larger, on as many lines
 *  as it needs, the cross centred beside them (2026-10-09 screenshots). */
export function MobileSheetTitleBar({
  title,
  onClose,
  wrap = false
}: {
  title: string
  onClose?: () => void
  wrap?: boolean
}) {
  const { colors, space } = useTheme()
  return (
    <View style={{ minHeight: 44, justifyContent: 'center', marginBottom: space.sm }}>
      <Txt
        variant="heading"
        weight={wrap ? 'bold' : 'semibold'}
        align="center"
        numberOfLines={wrap ? undefined : 1}
        scale={wrap ? WRAPPED_TITLE_SCALE : 1}
        style={{ marginHorizontal: 44 }}
      >
        {title}
      </Txt>
      {onClose ? (
        // Centred on the title's height, whatever number of lines it takes.
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1
            })}
          >
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
