import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { BottomDrawer } from './BottomDrawer'

type Props = {
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}: Props) {
  const { space } = useTheme()
  return (
    <BottomDrawer visible={visible} onClose={onCancel}>
      <View style={{ paddingBottom: space.lg, paddingHorizontal: space.xs }}>
        <Txt variant="heading" weight="semibold">
          {title}
        </Txt>
        {message ? (
          <Txt variant="body" tone="secondary" style={{ marginTop: space.xs }}>
            {message}
          </Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          onPress={() => {
            onConfirm()
            onCancel()
          }}
          style={{ flex: 1 }}
        />
      </View>
    </BottomDrawer>
  )
}
