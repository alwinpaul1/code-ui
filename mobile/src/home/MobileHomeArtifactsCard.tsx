import { ChevronRight } from 'lucide-react-native'
import { useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { anthropicSignedInCount, anthropicSignInPresenceVersion, subscribeAnthropicSignInPresence } from '../session/anthropic-sign-in-presence'
import { ClaudeArtifactsGlyph } from '../session/ClaudeArtifactsGlyph'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { SectionLabel } from '../ui/SectionLabel'
import { Txt } from '../ui/Txt'

export const HOME_ARTIFACTS_CAPTION = 'Yours and shared with you'

/**
 * Home's way into the account's Artifacts gallery (app/artifacts.tsx). The Claude Android app
 * 1.261013.20 has a top-level Artifacts tab (vew.java:16) and an Artifacts folder in its Code
 * overview (cs30.java:600); Code UI has no tab bar, so the gallery is a card here, drawn like the
 * Tasks card under its own heading (it sat inside the Tasks section until 2026-10-17, which read as
 * a kind of task). The heading goes with the card, so a signed-out home has no empty section. Only while an Anthropic account is signed in (anthropic-sign-in-presence.ts): the list
 * is read with that sign-in, and with none there is nothing to show.
 */
export function MobileHomeArtifactsCard(props: { onOpen: () => void }) {
  const { colors, radius, space } = useTheme()
  useSyncExternalStore(subscribeAnthropicSignInPresence, anthropicSignInPresenceVersion, anthropicSignInPresenceVersion)
  if ((anthropicSignedInCount() ?? 0) < 1) {
    return null
  }
  return (
    <>
    <SectionLabel>Artifacts</SectionLabel>
    <PressScale
      testID="home-artifacts-card"
      accessibilityRole="button"
      accessibilityLabel="Artifacts"
      pressedScale={0.985}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        minHeight: 72,
        paddingHorizontal: space.md,
        paddingVertical: space.md
      }}
      onPress={props.onOpen}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.bgRaised,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: space.md
        }}
      >
        <ClaudeArtifactsGlyph size={20} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body" weight="semibold">
          Artifacts
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
          {HOME_ARTIFACTS_CAPTION}
        </Txt>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </PressScale>
    </>
  )
}
