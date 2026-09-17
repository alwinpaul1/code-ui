import { View } from 'react-native'
import {
  BACKGROUND_POWER_NOT_TAKEN_PROMPT,
  BACKGROUND_POWER_PROMPT
} from '../background/background-delivery-power'
import { requestBackgroundDeliveryUnrestricted } from '../background/background-link'
import { saveBackgroundPowerRequestedNow } from '../storage/preferences'
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
  // Two messages, because "we are asking" and "that did not work" are different
  // things to say. Repeating the ask after a failed grant reads as the app not
  // having noticed, which is exactly what people reported.
  const copy = open === 'not-taken' ? BACKGROUND_POWER_NOT_TAKEN_PROMPT : BACKGROUND_POWER_PROMPT

  return (
    <BottomDrawer visible={open !== null} onClose={closeBackgroundPowerPrompt}>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
        <Txt variant="title" weight="semibold">
          {copy.title}
        </Txt>
        <Txt variant="body" tone="muted" style={{ lineHeight: 22 }}>
          {copy.body}
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
          <View style={{ flex: 1 }}>
            <Button
              label={copy.dismiss}
              variant="ghost"
              onPress={closeBackgroundPowerPrompt}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={copy.confirm}
              variant="accent"
              onPress={() => {
                closeBackgroundPowerPrompt()
                // Marked BEFORE the trip: the next foreground reads it to find
                // out whether the grant actually took, which is the whole point
                // of this follow-up.
                void saveBackgroundPowerRequestedNow()
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
