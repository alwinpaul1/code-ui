import { View } from 'react-native'
import { BACKGROUND_POWER_PROMPT } from '../background/background-delivery-power'
import { requestBackgroundDeliveryUnrestricted } from '../background/background-link'
import {
  closeBackgroundPowerPrompt,
  useBackgroundPowerPromptOpen
} from '../background/background-power-prompt-store'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { BottomDrawer } from './BottomDrawer'

/**
 * Why the app draws this itself: Android's battery dialog says "this may use
 * more battery" and nothing about what declining costs, so it gets dismissed
 * without being read, and the late notifications that follow are never
 * connected back to it. This sheet says what is lost first.
 *
 * It is the app's own sheet rather than `Alert.alert` because the native dialog
 * takes the system's colours, not the reader's chosen theme.
 */
export function MobileBackgroundPowerPrompt() {
  const open = useBackgroundPowerPromptOpen()
  const { colors, space } = useTheme()

  return (
    <BottomDrawer visible={open} onClose={closeBackgroundPowerPrompt}>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
        <Txt variant="title" weight="semibold">
          {BACKGROUND_POWER_PROMPT.title}
        </Txt>
        <Txt variant="body" tone="muted" style={{ lineHeight: 22 }}>
          {BACKGROUND_POWER_PROMPT.body}
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
          <View style={{ flex: 1 }}>
            <Button
              label={BACKGROUND_POWER_PROMPT.dismiss}
              variant="ghost"
              onPress={closeBackgroundPowerPrompt}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={BACKGROUND_POWER_PROMPT.confirm}
              variant="accent"
              onPress={() => {
                closeBackgroundPowerPrompt()
                requestBackgroundDeliveryUnrestricted()
              }}
            />
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: colors.border, opacity: 0 }} />
      </View>
    </BottomDrawer>
  )
}
