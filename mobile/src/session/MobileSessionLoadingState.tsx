import { ActivityIndicator, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { ClaudeTranscriptLoading } from './ClaudeTranscriptLoading'
import { LoadingConnectionTroubleContext, type LoadingConnectionTroubleState } from './loading-connection-trouble'
import { LoadingConnectionTroubleView } from './LoadingConnectionTroubleView'
import type { MobileSessionLoadingScreen } from './mobile-session-loading-screen'

/**
 * The loading screen itself. Clawd, or the spinner, gives way to the connection's trouble once the
 * host is known to be out of reach (loading-connection-trouble.ts), and comes back by itself when
 * the trouble clears.
 */
export function MobileSessionLoadingState({
  screen,
  trouble
}: {
  screen: Exclude<MobileSessionLoadingScreen, null>
  trouble: LoadingConnectionTroubleState | null
}) {
  const { colors, space } = useTheme()
  return (
    <LoadingConnectionTroubleContext.Provider value={trouble}>
      <View testID="session-loading" style={{ flex: 1, backgroundColor: colors.chatBg }}>
        {screen === 'claude' ? (
          <ClaudeTranscriptLoading />
        ) : trouble ? (
          <LoadingConnectionTroubleView state={trouble} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        )}
      </View>
    </LoadingConnectionTroubleContext.Provider>
  )
}
