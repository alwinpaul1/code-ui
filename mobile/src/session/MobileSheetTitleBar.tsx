import type { ReactNode } from 'react'
import { X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** A sheet's top row as the Claude app draws it: a close cross on the left
 *  and the title centred across the whole width (2026-09-24 recordings).
 *  `wrap` is the run sheet's title: a whole sentence ("Ran 3 commands (2
 *  failed), / used 2 tools, created a file"), on as many lines
 *  as it needs, the cross centred beside them (2026-10-09 screenshots). */
export function MobileSheetTitleBar({
  title,
  onClose,
  wrap = false,
  trailing
}: {
  title: string
  onClose?: () => void
  wrap?: boolean
  /** A control at the row's end, centred on its height as the cross is at the
   *  start (the code sheet's Copy). The title keeps its 44 dp each side, which
   *  clears a control up to 44 dp wide: the sheet's 40 sp Copy, until the
   *  system font size passes about 1.1, when a long title could meet it. */
  trailing?: ReactNode
}) {
  const { colors, space } = useTheme()
  return (
    <View
      style={
        wrap
          ? { minHeight: 36, justifyContent: 'center', marginBottom: 2 }
          : { minHeight: 44, justifyContent: 'center', marginBottom: space.sm }
      }
    >
      <Txt
        variant="heading"
        weight="semibold"
        align="center"
        numberOfLines={wrap ? undefined : 1}
        style={{ marginHorizontal: 44 }}
      >
        {title}
      </Txt>
      {onClose ? (
        // Centred on the title's height, whatever number of lines it takes.
        <View pointerEvents="box-none" style={{ position: 'absolute', left: wrap ? 8 : 0, top: 0, bottom: 0, justifyContent: 'center' }}>
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
      {trailing ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
          {trailing}
        </View>
      ) : null}
    </View>
  )
}
