import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { SectionLabel } from '../ui/SectionLabel'
import { Txt } from '../ui/Txt'

export function greetingForHour(hour: number): string {
  if (hour < 5) {
    return 'Still up?'
  }
  if (hour < 12) {
    return 'Good morning'
  }
  if (hour < 18) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

export function MobileHomeListHeader() {
  const { space } = useTheme()
  return (
    <View>
      <View style={{ paddingTop: space.md, paddingBottom: space.lg }}>
        <Txt variant="display" weight="semibold">
          {greetingForHour(new Date().getHours())}
        </Txt>
      </View>
      <SectionLabel>Desktops</SectionLabel>
    </View>
  )
}
