import { View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from './Txt'

/** Small uppercase heading with an optional trailing count or action. */
export function SectionLabel({
  children,
  trailing,
  style
}: {
  children: string
  trailing?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const { space } = useTheme()
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: space.xs,
          marginTop: space.xl,
          marginBottom: space.sm
        },
        style
      ]}
    >
      <Txt
        variant="caption"
        weight="semibold"
        tone="muted"
        style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
      >
        {children}
      </Txt>
      {trailing}
    </View>
  )
}
