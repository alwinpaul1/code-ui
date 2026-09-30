import type { ReactNode } from 'react'
import { ActivityIndicator, View, Pressable } from 'react-native'
import { Check } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import { BottomDrawer } from './BottomDrawer'

export type PickerOption<T extends string = string> = {
  value: T
  label: string
  subtitle?: string
  disabled?: boolean
  renderIcon?: (selected: boolean) => ReactNode
}

type Props<T extends string = string> = {
  visible: boolean
  title: string
  options: PickerOption<T>[]
  selected: T
  onSelect: (value: T) => void
  onLongSelect?: (value: T) => void
  onClose: () => void
  onAfterClose?: () => void
  zIndex?: number
  // Optional notices drawn IN PLACE of the rows. A caller that sets none renders exactly as before
  // (an empty options list is an empty sheet). A picker whose options come from a read uses them
  // so a slow read, a failed read and a real "none" never share one blank sheet.
  /** The options are still being read. */
  loadingLabel?: string
  /** Reading the options failed. `retryLabel` is the Retry button's accessibility label. */
  failure?: { message: string; onRetry: () => void; retryLabel?: string }
  /** The read answered, with no options. */
  emptyLabel?: string
}

type PickerModalContentProps<T extends string = string> = Pick<
  Props<T>,
  'options' | 'selected' | 'onSelect' | 'onLongSelect' | 'onClose'
>

export function PickerModal<T extends string = string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onLongSelect,
  onClose,
  onAfterClose,
  zIndex,
  loadingLabel,
  failure,
  emptyLabel
}: Props<T>) {
  const { space } = useTheme()
  const notice = failure ? (
    <PickerModalNotice
      message={failure.message}
      onRetry={failure.onRetry}
      retryLabel={failure.retryLabel}
    />
  ) : loadingLabel ? (
    <PickerModalNotice message={loadingLabel} busy />
  ) : options.length === 0 && emptyLabel ? (
    <PickerModalNotice message={emptyLabel} />
  ) : null
  return (
    <BottomDrawer visible={visible} onClose={onClose} onAfterClose={onAfterClose} zIndex={zIndex}>
      <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
        <Txt variant="label" weight="medium" tone="muted">
          {title}
        </Txt>
      </View>

      {notice ?? (
        <PickerModalContent
          options={options}
          selected={selected}
          onSelect={onSelect}
          onLongSelect={onLongSelect}
          onClose={onClose}
        />
      )}
    </BottomDrawer>
  )
}

function PickerModalNotice({
  message,
  busy = false,
  onRetry,
  retryLabel = 'Retry'
}: {
  message: string
  busy?: boolean
  onRetry?: () => void
  retryLabel?: string
}) {
  const { colors, radius, space } = useTheme()
  return (
    <Surface
      rounded="lg"
      style={{ padding: space.md + 2, gap: space.md, alignItems: 'flex-start' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        <Txt variant="body" tone="muted">
          {message}
        </Txt>
      </View>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={{
            paddingVertical: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.bgRaised
          }}
        >
          <Txt variant="body" weight="medium">
            Retry
          </Txt>
        </Pressable>
      ) : null}
    </Surface>
  )
}

function PickerModalContent<T extends string = string>({
  options,
  selected,
  onSelect,
  onLongSelect,
  onClose
}: PickerModalContentProps<T>) {
  const { colors, space } = useTheme()
  // Why: closed BottomDrawer instances return null, so keeping option rows in
  // this child avoids rebuilding hidden picker contents on every parent render.
  return (
    <Surface rounded="lg" style={{ overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const isSelected = opt.value === selected
        return (
          <View key={opt.value}>
            {i > 0 && (
              <View
                style={{ height: 1, backgroundColor: colors.border, marginHorizontal: space.md }}
              />
            )}
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(opt.disabled), selected: isSelected }}
              disabled={opt.disabled}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: space.md + 2,
                paddingHorizontal: space.md + 2,
                backgroundColor: pressed && !opt.disabled ? colors.bgRaised : 'transparent',
                opacity: opt.disabled ? 0.45 : 1
              })}
              onPress={() => {
                if (opt.disabled) {
                  return
                }
                onSelect(opt.value)
                onClose()
              }}
              onLongPress={
                onLongSelect
                  ? () => {
                      if (opt.disabled) {
                        return
                      }
                      onLongSelect(opt.value)
                      onClose()
                    }
                  : undefined
              }
            >
              {opt.renderIcon ? (
                <View style={{ width: 22, alignItems: 'center', marginRight: space.sm }}>
                  {opt.renderIcon(isSelected)}
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="body" weight={isSelected ? 'semibold' : 'regular'}>
                  {opt.label}
                </Txt>
                {opt.subtitle ? (
                  <Txt variant="caption" tone="muted" style={{ marginTop: 1 }}>
                    {opt.subtitle}
                  </Txt>
                ) : null}
              </View>
              {isSelected && <Check size={16} color={colors.accentText} strokeWidth={2.5} />}
            </Pressable>
          </View>
        )
      })}
    </Surface>
  )
}
