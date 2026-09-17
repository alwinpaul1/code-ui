import { Settings } from 'lucide-react-native'
import { View } from 'react-native'
import { AppLogo } from '../components/AppLogo'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'

export function MobileHomeTopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { space } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: space.lg,
        paddingRight: space.sm,
        paddingTop: space.sm,
        paddingBottom: space.xs
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
        <AppLogo size={20} />
        <Txt variant="heading" weight="semibold">
          Code UI
        </Txt>
      </View>
      <IconButton icon={Settings} accessibilityLabel="Settings" onPress={onOpenSettings} />
    </View>
  )
}
