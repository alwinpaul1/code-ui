import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { AlertTriangle } from 'lucide-react-native'
import type { ErrorBoundaryProps } from 'expo-router'

import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

// Orca issue #16328: mobile had no error boundary, so a render throw killed
// the process with nothing on screen. expo-router mounts this for any route
// under the root layout that throws; the user gets the message, a retry and a
// way home instead of a dead app.
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, space } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const detail = error.stack ?? error.message

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.xl
      }}
    >
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <AlertTriangle size={36} color={colors.warning} />
        <Txt variant="title" weight="semibold" align="center">
          Something went wrong
        </Txt>
        <Txt variant="body" tone="secondary" align="center">
          {error.message || 'The screen hit an error it could not recover from.'}
        </Txt>
      </View>
      <ScrollView
        style={{
          flex: 1,
          marginVertical: space.lg,
          backgroundColor: colors.codeBg,
          borderRadius: 12
        }}
        contentContainerStyle={{ padding: space.md }}
      >
        <Txt variant="mono" tone="secondary" selectable>
          {detail}
        </Txt>
      </ScrollView>
      <View style={{ gap: space.sm }}>
        <Button label="Try again" variant="accent" block onPress={() => void retry()} />
        <Button label="Go to Home" variant="secondary" block onPress={() => router.replace('/')} />
      </View>
    </View>
  )
}
