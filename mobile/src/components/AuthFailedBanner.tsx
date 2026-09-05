import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

// Why: auth-failed is no longer necessarily terminal (issue #5200) — a
// transient rejection can latch it even though the desktop still lists this
// device. Offer Retry (fresh client + handshake) ahead of the disruptive
// re-pair flow so the common transient case recovers without re-pairing.
export function AuthFailedBanner({
  canRetry,
  onRetry,
  onRepair,
  onRemove
}: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}) {
  const { colors, space } = useTheme()
  return (
    <View
      style={{
        backgroundColor: colors.dangerSoft,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: space.sm
      }}
    >
      <Txt variant="label" tone="danger">
        Authentication failed. Try reconnecting first; if it keeps failing, re-pair from the
        desktop.
      </Txt>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {canRetry && <Button label="Retry" size="sm" variant="primary" onPress={onRetry} />}
        <Button label="Re-pair" size="sm" variant="secondary" onPress={onRepair} />
        <Button label="Remove" size="sm" variant="ghost" onPress={onRemove} />
      </View>
    </View>
  )
}
