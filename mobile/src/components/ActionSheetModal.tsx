import { useRef, type ReactNode } from 'react'
import { ActivityIndicator, View, Pressable } from 'react-native'
import { Edit3, Trash2, type LucideIcon } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import { BottomDrawer } from './BottomDrawer'

export type ActionSheetAction = {
  label: string
  icon?: LucideIcon
  renderIcon?: () => ReactNode
  destructive?: boolean
  disabled?: boolean
  hint?: string
  loading?: boolean
  skipAutoClose?: boolean
  closeBeforePress?: boolean
  onPress: () => void
}

type Props = {
  visible: boolean
  title?: string
  message?: string
  actions: ActionSheetAction[]
  onClose: () => void
}

function iconForAction(label: string, destructive?: boolean, icon?: LucideIcon): LucideIcon {
  if (icon) {
    return icon
  }
  if (destructive || /delete|remove/i.test(label)) {
    return Trash2
  }
  return Edit3
}

type ContentProps = {
  title?: string
  message?: string
  actions: ActionSheetAction[]
  onClose?: () => void
}

export function ActionSheetContent({ title, message, actions, onClose }: ContentProps) {
  const { colors, space } = useTheme()
  return (
    <>
      {(title || message) && (
        <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
          {title ? (
            <Txt variant="label" weight="medium" tone="muted" numberOfLines={1}>
              {title}
            </Txt>
          ) : null}
          {message ? (
            <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {message}
            </Txt>
          ) : null}
        </View>
      )}

      <Surface rounded="lg" style={{ overflow: 'hidden' }}>
        {actions.map((action, i) => {
          const Icon = iconForAction(action.label, action.destructive, action.icon)
          const customIcon = action.renderIcon?.()
          return (
            <View key={action.label}>
              {i > 0 && (
                <View
                  style={{ height: 1, backgroundColor: colors.border, marginHorizontal: space.md }}
                />
              )}
              <Pressable
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm + 2,
                  paddingVertical: space.md + 2,
                  paddingHorizontal: space.md + 2,
                  backgroundColor:
                    pressed && !action.disabled && !action.loading
                      ? colors.bgRaised
                      : 'transparent',
                  opacity: action.disabled ? 0.55 : 1
                })}
                disabled={action.disabled || action.loading}
                onPress={() => {
                  action.onPress()
                  if (!action.skipAutoClose && onClose) {
                    onClose()
                  }
                }}
              >
                {customIcon ?? (
                  <Icon
                    size={17}
                    color={action.destructive ? colors.danger : colors.textSecondary}
                    strokeWidth={2}
                  />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt
                    variant="body"
                    weight="medium"
                    tone={action.destructive ? 'danger' : action.disabled ? 'secondary' : 'primary'}
                  >
                    {action.label}
                  </Txt>
                  {action.hint ? (
                    <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                      {action.hint}
                    </Txt>
                  ) : null}
                </View>
                {action.loading ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : null}
              </Pressable>
            </View>
          )
        })}
      </Surface>
    </>
  )
}

export function ActionSheetModal({ visible, title, message, actions, onClose }: Props) {
  const pendingActionRef = useRef<(() => void) | null>(null)
  const sequencedActions = actions.map((action) =>
    action.closeBeforePress
      ? {
          ...action,
          onPress: () => {
            pendingActionRef.current = action.onPress
          }
        }
      : action
  )

  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      onAfterClose={() => {
        // Why: iOS cannot present a second native modal until the action
        // sheet's native window has fully unmounted.
        const pendingAction = pendingActionRef.current
        pendingActionRef.current = null
        pendingAction?.()
      }}
      dragContentToDismiss
    >
      <ActionSheetContent
        title={title}
        message={message}
        actions={sequencedActions}
        onClose={onClose}
      />
    </BottomDrawer>
  )
}
