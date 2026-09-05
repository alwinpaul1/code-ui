import type { ReactNode } from 'react'
import { View, Pressable } from 'react-native'
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
  zIndex
}: Props<T>) {
  const { space } = useTheme()
  return (
    <BottomDrawer visible={visible} onClose={onClose} onAfterClose={onAfterClose} zIndex={zIndex}>
      <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
        <Txt variant="label" weight="medium" tone="muted">
          {title}
        </Txt>
      </View>

      <PickerModalContent
        options={options}
        selected={selected}
        onSelect={onSelect}
        onLongSelect={onLongSelect}
        onClose={onClose}
      />
    </BottomDrawer>
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
