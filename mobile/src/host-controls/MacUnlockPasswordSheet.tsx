import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { clearMacUnlockPassword, writeMacUnlockPassword } from './mac-unlock-password-store'

/** Asked for once, then kept in the phone's keychain. Tapping Unlock with nothing
 *  saved opens this instead of running anything. */
export function MacUnlockPasswordSheet({
  hostId,
  onClose,
  onSaved
}: {
  hostId: string | null
  onClose: () => void
  onSaved: (hostId: string, password: string) => void
}) {
  const { colors, radius, space } = useTheme()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [previousHostId, setPreviousHostId] = useState(hostId)

  // Why: clear the draft on open, not on close, so the field is empty next time
  // without blanking during the sheet's slide-out.
  if (hostId !== previousHostId) {
    setPreviousHostId(hostId)
    if (hostId) {
      setPassword('')
      setVisible(false)
    }
  }

  return (
    <BottomDrawer visible={hostId != null} onClose={onClose}>
      <View style={{ paddingHorizontal: space.xs, gap: space.sm }}>
        <Txt variant="heading" weight="semibold">
          Unlock Mac
        </Txt>
        <View style={{ justifyContent: 'center' }}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            style={{
              backgroundColor: colors.bgSunken,
              borderColor: colors.border,
              borderRadius: radius.md,
              borderWidth: 1,
              color: colors.text,
              fontSize: 16,
              paddingLeft: space.md,
              paddingRight: 44,
              paddingVertical: space.sm + 2
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible((shown) => !shown)}
            hitSlop={8}
            style={{
              position: 'absolute',
              right: 4,
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {visible ? (
              <EyeOff size={18} color={colors.textSecondary} strokeWidth={2} />
            ) : (
              <Eye size={18} color={colors.textSecondary} strokeWidth={2} />
            )}
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Save and unlock"
            disabled={password.length === 0}
            onPress={() => {
              const hostToUnlock = hostId
              if (!hostToUnlock) {
                return
              }
              void writeMacUnlockPassword(hostToUnlock, password).catch(() => undefined)
              onSaved(hostToUnlock, password)
              setPassword('')
            }}
          />
          <Button
            label="Forget"
            variant="secondary"
            onPress={() => {
              if (hostId) {
                void clearMacUnlockPassword(hostId).catch(() => undefined)
              }
              setPassword('')
              onClose()
            }}
          />
        </View>
      </View>
    </BottomDrawer>
  )
}
