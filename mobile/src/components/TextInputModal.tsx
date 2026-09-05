import { useState } from 'react'
import { View, TextInput, Platform, type KeyboardTypeOptions } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { BottomDrawer } from './BottomDrawer'

type Props = {
  visible: boolean
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  submitLabel?: string
  selectTextOnFocus?: boolean
  allowEmpty?: boolean
  keyboardType?: KeyboardTypeOptions
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function TextInputModal({
  visible,
  title,
  message,
  defaultValue = '',
  placeholder,
  submitLabel = 'Save',
  selectTextOnFocus = false,
  allowEmpty = false,
  keyboardType,
  onSubmit,
  onCancel
}: Props) {
  const { colors, fonts, radius, space, type } = useTheme()
  const [value, setValue] = useState(defaultValue)
  const [previousVisible, setPreviousVisible] = useState(visible)
  const [previousDefaultValue, setPreviousDefaultValue] = useState(defaultValue)

  // Why: reset before the opening commit so the drawer never paints the
  // previous modal value while preserving the existing close animation state.
  const shouldResetValue = visible && (!previousVisible || defaultValue !== previousDefaultValue)
  if (visible !== previousVisible || shouldResetValue) {
    setPreviousVisible(visible)
    if (shouldResetValue) {
      setPreviousDefaultValue(defaultValue)
      setValue(defaultValue)
    }
  }

  function handleSubmit() {
    const trimmed = value.trim()
    if (trimmed || allowEmpty) {
      onSubmit(trimmed)
    }
  }

  const canSubmit = allowEmpty || value.trim().length > 0

  return (
    <BottomDrawer visible={visible} onClose={onCancel}>
      <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
        <Txt variant="heading" weight="semibold">
          {title}
        </Txt>
        {message ? (
          <Txt variant="label" tone="muted" style={{ marginTop: 2 }}>
            {message}
          </Txt>
        ) : null}
      </View>

      <TextInput
        style={{
          backgroundColor: colors.bgPanel,
          color: colors.text,
          fontFamily: fonts.regular,
          fontSize: type.body.size,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          paddingVertical: Platform.OS === 'ios' ? space.sm + 4 : space.sm + 2,
          borderWidth: 1,
          borderColor: colors.borderStrong
        }}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        selectTextOnFocus={selectTextOnFocus}
        keyboardType={keyboardType}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        selectionColor={colors.accent}
      />

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: space.sm,
          marginTop: space.md
        }}
      >
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
        <Button label={submitLabel} variant="primary" disabled={!canSubmit} onPress={handleSubmit} />
      </View>
    </BottomDrawer>
  )
}
