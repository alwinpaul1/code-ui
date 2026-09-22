import { Text } from 'react-native'
import { useTheme } from '../theme/theme-context'
import type { DictationPaint } from '../hooks/mobile-live-transcript'

export function DictationComposerPaint({
  paint
}: {
  paint: DictationPaint
}): React.JSX.Element {
  const { colors, fonts, space, type } = useTheme()
  return (
    <Text
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        fontFamily: fonts.regular,
        fontSize: type.body.size + 1,
        lineHeight: type.body.lineHeight + 1,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        paddingBottom: space.xs
      }}
    >
      <Text style={{ color: colors.text }}>{paint.before}</Text>
      <Text style={{ color: colors.textMuted }}>{paint.interim}</Text>
      <Text style={{ color: colors.text }}>{paint.after}</Text>
    </Text>
  )
}
