import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { clearMacUnlockPassword, writeMacUnlockPassword } from './mac-unlock-password-store'

/** Asked for once, then kept in the phone's keychain. Tapping Unlock with nothing
 *  saved opens this instead of running anything. */
export function MacUnlockPasswordSheet({
  hostId,
  hostName,
  onClose,
  onSaved
}: {
  hostId: string | null
  hostName: string | null
  onClose: () => void
  onSaved: (hostId: string, password: string) => void
}) {
  const { colors, radius, space } = useTheme()
  const [password, setPassword] = useState('')
  const [previousHostId, setPreviousHostId] = useState(hostId)

  // Why: clear the draft on open, not on close, so the field is empty next time
  // without blanking during the sheet's slide-out.
  if (hostId !== previousHostId) {
    setPreviousHostId(hostId)
    if (hostId) {
      setPassword('')
    }
  }

  return (
    <BottomDrawer visible={hostId != null} onClose={onClose}>
      <View style={{ paddingHorizontal: space.xs, gap: space.sm }}>
        <Txt variant="heading" weight="semibold">
          Mac unlock password
        </Txt>
        <Txt variant="caption" tone="muted">
          {hostName
            ? `The login password for ${hostName}. It is stored on this phone and sent to the Mac when you tap Unlock.`
            : 'The Mac login password. It is stored on this phone and sent to the Mac when you tap Unlock.'}
        </Txt>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
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
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2
          }}
        />
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
