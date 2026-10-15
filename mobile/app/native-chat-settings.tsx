import { View, ScrollView, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import { useMobileDefaultSessionViewPreference } from '../src/session/use-mobile-default-session-view-preference'
import { useMobileChatFocusViewPreference } from '../src/session/use-mobile-chat-focus-view'
import { useMobileChatExpandToolsPreference } from '../src/session/use-mobile-chat-expand-tools'
import { useMobileRemoteControlPreference } from '../src/session/use-mobile-remote-control-preference'
import { ChatReadingOptionGroup, type ChatReadingOption } from '../src/settings/ChatReadingOptionGroup'
import {
  chatCodeFont,
  chatTranscriptFonts,
  useChatReadingPreference,
  type ChatCodeFont,
  type ChatTextSize,
  type ChatTranscriptFont
} from '../src/settings/chat-reading-settings'

// The Claude app's labels (gd9.java:52-66, 610-665; strings.xml). Instrument Sans stands where
// Claude's Anthropic Sans does: it is the face this app ships and the transcript has always used.
const TEXT_SIZE_OPTIONS: readonly ChatReadingOption<ChatTextSize>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' }
]
// Each font option is drawn in the face it picks, so the choice is seen before it is made.
const TRANSCRIPT_FONT_OPTIONS: readonly ChatReadingOption<ChatTranscriptFont>[] = [
  { value: 'instrument_sans', label: 'Instrument Sans', face: chatTranscriptFonts('instrument_sans').regular },
  { value: 'system', label: 'System', face: chatTranscriptFonts('system').regular }
]
const CODE_FONT_OPTIONS: readonly ChatReadingOption<ChatCodeFont>[] = [
  { value: 'system', label: 'System', face: chatCodeFont('system') },
  { value: 'jetbrains_mono', label: 'JetBrains Mono', face: chatCodeFont('jetbrains_mono') }
]

export default function NativeChatSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()

  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'
  const { focusView, setFocusView } = useMobileChatFocusViewPreference()
  const { expandTools, setExpandTools } = useMobileChatExpandToolsPreference()
  const { remoteControl, setRemoteControl } = useMobileRemoteControlPreference()
  const reading = useChatReadingPreference()

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
        <SectionLabel style={{ marginTop: space.lg }}>Tool activity</SectionLabel>
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
              Focus view
            </Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {focusView ? 'On: tool calls fold to one row per turn' : 'Off'}
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Focus view"
            value={focusView}
            onValueChange={setFocusView}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.bgPanel}
          />
        </Surface>
        <Surface
          rounded="lg"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.md,
            paddingHorizontal: space.lg,
            marginTop: space.sm
          }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="body" weight="medium">
              Expand tool calls
            </Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {expandTools ? 'On: every tool call opens with its details' : 'Off'}
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Expand tool calls"
            value={expandTools}
            onValueChange={setExpandTools}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.bgPanel}
          />
        </Surface>
        <SectionLabel style={{ marginTop: space.lg }}>Claude sessions</SectionLabel>
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
              Remote Control for new Claude sessions
            </Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {remoteControl
                ? 'On: sessions started here open in the Claude app too'
                : 'Off'}
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Remote Control for new Claude sessions"
            value={remoteControl}
            onValueChange={setRemoteControl}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.bgPanel}
          />
        </Surface>
        <SectionLabel style={{ marginTop: space.lg }}>Appearance</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden', paddingBottom: space.sm }}>
          <ChatReadingOptionGroup
            title="Transcript text size"
            options={TEXT_SIZE_OPTIONS}
            value={reading.settings.textSize}
            onChange={reading.setTextSize}
          />
          <ChatReadingOptionGroup
            title="Transcript font"
            options={TRANSCRIPT_FONT_OPTIONS}
            value={reading.settings.transcriptFont}
            onChange={reading.setTranscriptFont}
          />
        </Surface>
        <SectionLabel style={{ marginTop: space.lg }}>Code appearance</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <View style={{ paddingBottom: space.sm }}>
            <ChatReadingOptionGroup
              title="Code font"
              options={CODE_FONT_OPTIONS}
              value={reading.settings.codeFont}
              onChange={reading.setCodeFont}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.lg,
              borderTopWidth: 1,
              borderTopColor: colors.border
            }}
          >
            <View style={{ flex: 1 }}>
              <Txt variant="body" weight="medium">
                Wrap long lines
              </Txt>
            </View>
            <Switch
              accessibilityLabel="Wrap long lines"
              value={reading.settings.wrapLongLines}
              onValueChange={reading.setWrapLongLines}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.bgPanel}
            />
          </View>
        </Surface>
      </ScrollView>
    </View>
  )
}
