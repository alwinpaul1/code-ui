import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { HostScreenHeader } from './host-screen-header'
import { HostScreenOverlays } from './host-screen-overlays'
import { HostWorkspaceList } from './host-workspace-list'
import type { HostScreenController } from './use-host-screen-controller'

export function HostScreenView({ controller }: { controller: HostScreenController }) {
  const { colors, space } = useTheme()
  if (controller.state.error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
          padding: space.xl
        }}
      >
        <Txt variant="body" tone="danger" align="center">
          {controller.state.error}
        </Txt>
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <HostScreenHeader controller={controller} />
      <HostWorkspaceList controller={controller} />
      <HostScreenOverlays controller={controller} />
    </SafeAreaView>
  )
}
