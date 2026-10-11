import { Linking, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

// The Claude Android app's Auto mode opt-in (1.261009.20), in its words. It
// asks once, the first time Auto is picked, and remembers a yes on the device.

export const AUTO_MODE_OPT_IN_TITLE = 'Enable Auto mode?'
export const AUTO_MODE_OPT_IN_BODY =
  'Auto mode lets Claude handle permission decisions during coding sessions, so developers can run longer tasks without being interrupted by Claude asking for manual approvals. Auto mode also includes additional safeguards against prompt injections.'
export const AUTO_MODE_LEARN_MORE_URL = 'https://code.claude.com/docs/en/security'

export function MobileAutoModeOptInSheet({
  visible,
  onEnable,
  onClose
}: {
  visible: boolean
  onEnable: () => void
  onClose: () => void
}): React.JSX.Element {
  const { space } = useTheme()
  return (
    <BottomDrawer visible={visible} onClose={onClose} dismissKeyboardOnOpen>
      <View style={{ paddingBottom: space.lg, paddingHorizontal: space.xs }}>
        <Txt variant="heading" weight="semibold">
          {AUTO_MODE_OPT_IN_TITLE}
        </Txt>
        <Txt variant="body" tone="secondary" style={{ marginTop: space.xs }}>
          {AUTO_MODE_OPT_IN_BODY}
        </Txt>
        <Txt
          variant="body"
          tone="accent"
          accessibilityRole="link"
          style={{ marginTop: space.sm }}
          onPress={() => void Linking.openURL(AUTO_MODE_LEARN_MORE_URL).catch(() => {})}
        >
          Learn more
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Not now" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label="Enable" variant="primary" onPress={onEnable} style={{ flex: 1 }} />
      </View>
    </BottomDrawer>
  )
}
