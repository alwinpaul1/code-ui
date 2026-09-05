import { View, ScrollView, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import { useMobileDefaultSessionViewPreference } from '../src/session/use-mobile-default-session-view-preference'

export default function NativeChatSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()

  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'

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
        <Txt variant="label" tone="secondary" style={{ marginTop: space.md, paddingHorizontal: space.xs }}>
          Chat-capable agents (Claude, Codex and others) can open as a readable transcript instead of
          the raw terminal. The terminal is always one long-press away on the session tab, and the
          agent keeps running on your desktop either way.
        </Txt>
      </ScrollView>
    </View>
  )
}
