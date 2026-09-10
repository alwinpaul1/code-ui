import { useEffect, useState } from 'react'
import { View, ScrollView, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import { useMobileDefaultSessionViewPreference } from '../src/session/use-mobile-default-session-view-preference'
import {
  loadDesktopHudLaunchEnabled,
  saveDesktopHudLaunchEnabled
} from '../src/session/desktop-hud-launch-preference'
import { syncAgentHudDesktopLaunchArgs } from '../src/session/agent-hud-desktop-launch-args'
import { useAllHostClients } from '../src/transport/use-all-host-clients'
import { loadHostCatalog } from '../src/transport/host-store'

export default function NativeChatSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()

  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'
  const [desktopHud, setDesktopHud] = useState(true)
  useEffect(() => {
    void loadDesktopHudLaunchEnabled().then(setDesktopHud)
  }, [])
  const [hostIds, setHostIds] = useState<string[]>([])
  useEffect(() => {
    void loadHostCatalog()
      .then((catalog) => setHostIds(catalog.map((host) => host.id)))
      .catch(() => setHostIds([]))
  }, [])
  const clients = useAllHostClients(hostIds, { autoConnectHostIds: [], closeUnusedOnRelease: false })
  const toggleDesktopHud = async (next: boolean) => {
    setDesktopHud(next)
    await saveDesktopHudLaunchEnabled(next)
    for (const entry of clients) {
      if (entry.client.getState() === 'connected') {
        void syncAgentHudDesktopLaunchArgs(entry.client, next).catch(() => null)
      }
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Chat UI" onBack={() => router.back()} large />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl
        }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel style={{ marginTop: space.sm }}>Default view</SectionLabel>
        <Surface
          rounded="lg"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.md,
            paddingHorizontal: space.lg
          }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="body" weight="medium">
              Open sessions in Chat UI
            </Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {chatDefault ? 'On' : 'Off'}
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Open sessions in Chat UI"
            value={chatDefault}
            onValueChange={(next) => setDefaultView(next ? 'chat' : 'terminal')}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.bgPanel}
          />
        </Surface>
        <SectionLabel style={{ marginTop: space.lg }}>Model and context on the desktop</SectionLabel>
        <Surface
          rounded="lg"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.md,
            paddingHorizontal: space.lg
          }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="body" weight="medium">
              Desktop agents report model and context
            </Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {desktopHud ? 'On' : 'Off'}
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Desktop agents report model and context"
            value={desktopHud}
            onValueChange={(next) => void toggleDesktopHud(next)}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.bgPanel}
          />
        </Surface>
      </ScrollView>
    </View>
  )
}
