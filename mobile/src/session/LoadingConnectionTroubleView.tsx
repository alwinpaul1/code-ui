import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { MIN_TAP_TARGET } from '../ui/tap-target'
import { Txt } from '../ui/Txt'
import { CLAUDE_TRANSCRIPT_LOADING } from './claude-transcript-loading-spec'
import type { LoadingConnectionTroubleState } from './loading-connection-trouble'
import { ViewportCentred } from './viewport-centre'

/** The trouble's words and its Retry, under Clawd or alone where the spinner was. */
export function LoadingConnectionTroubleBody({ state }: { state: LoadingConnectionTroubleState }) {
  const { colors, radius, space } = useTheme()
  const spec = CLAUDE_TRANSCRIPT_LOADING
  return (
    <View
      testID="loading-connection-trouble"
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', gap: space.sm, paddingHorizontal: spec.labelPaddingHorizontal }}
    >
      <Txt variant="label" align="center">
        {state.trouble.label}
      </Txt>
      {state.trouble.detail ? (
        <Txt variant="label" tone="secondary" align="center">
          {state.trouble.detail}
        </Txt>
      ) : null}
      {state.onRetry ? (
        // Drawn as the secondary Button, without its press spring and haptics (Button ->
        // PressScale): this sits under Clawd, whose module stays as light as a loading mark.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reconnect to desktop"
          onPress={state.onRetry}
          style={({ pressed }) => ({
            minHeight: MIN_TAP_TARGET,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgRaised,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1
          })}
        >
          <Txt variant="label" weight="semibold">
            Retry
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

/** The trouble alone, centred, where a plain spinner would otherwise turn forever. */
export function LoadingConnectionTroubleView({
  state,
  style
}: {
  state: LoadingConnectionTroubleState
  style?: StyleProp<ViewStyle>
}) {
  return (
    <ViewportCentred style={style}>
      <LoadingConnectionTroubleBody state={state} />
    </ViewportCentred>
  )
}
