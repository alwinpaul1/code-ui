import { Stack } from 'expo-router'
import { useTheme } from '../theme/theme-context'
import { HOST_STACK_SCREENS, type HostStackAnimation } from './host-stack-screens'

export function HostStack({ animation }: { animation: HostStackAnimation }) {
  const { colors } = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        // In the tablet split view the detail pane should swap instantly like
        // a desktop master-detail; the default slide animates the outgoing
        // screen and briefly reveals the one beneath it. Phones keep the slide.
        animation
      }}
    >
      {HOST_STACK_SCREENS.map(({ name, title }) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  )
}
