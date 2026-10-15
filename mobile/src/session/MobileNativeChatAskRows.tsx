import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { useTheme } from '../theme/theme-context'
import { tapTargetHitSlop } from '../ui/tap-target'
import { Txt } from '../ui/Txt'

/** The free answer's row, in the Claude app's words (`question_card_other_hint`,
 *  1.261009.20). */
export const ASK_OTHER_LABEL = 'Something else'
/** A row's corner: bn7.f, 12 dp (zlw.java:12). */
const ASK_ROW_RADIUS = 12

/** A 36 dp target around a 20 dp chevron (bf4.java: 36 and 20). A disabled one
 *  sinks to 0.38 (inferred: ff4 draws no disabled colour of its own). */
export function PagerButton({
  label,
  disabled,
  onPress,
  children
}: {
  label: string
  disabled: boolean
  onPress: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={tapTargetHitSlop({ width: 36, height: 36 }, { horizontalGap: 0 })}
      style={{
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.38 : 1
      }}
    >
      {children}
    </Pressable>
  )
}

/** The line between two rows: 1 dp, 12 dp in from each side, ad5.A(); clear while a
 *  neighbour is pressed (dc5.java j()). */
export function Rule({ hidden }: { hidden: boolean }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={{
        height: 1,
        marginHorizontal: 12,
        backgroundColor: hidden ? 'transparent' : colors.askDivider
      }}
    />
  )
}

/** The 28 dp square in front of a row (lut.java:15258 f()): a number badge on a
 *  single-select card, a checkbox on a multi-select one. */
function RowMark({
  number,
  selected,
  pressed,
  multi
}: {
  number: number | null
  selected: boolean
  pressed: boolean
  multi: boolean
}): React.JSX.Element {
  const { colors } = useTheme()
  if (multi) {
    return (
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: selected ? colors.askText : colors.askMuted,
            backgroundColor: selected ? colors.askText : 'transparent',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {selected ? <Check size={13} color={colors.askCardFill} strokeWidth={3} /> : null}
        </View>
      </View>
    )
  }
  const strong = selected || pressed
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: strong ? colors.askBadgeStrong : colors.askBadge
      }}
    >
      {number !== null ? (
        <Txt variant="body" style={{ color: strong ? colors.askText : colors.askMuted }}>
          {String(number)}
        </Txt>
      ) : selected ? (
        <Check size={18} color={colors.askText} strokeWidth={2.4} />
      ) : null}
    </View>
  )
}

export function OptionRow({
  label,
  description,
  number,
  selected,
  multi,
  disabled = false,
  opacity,
  onPressedChange,
  onPress
}: {
  label: string
  description?: string
  number: number | null
  selected: boolean
  multi?: boolean
  /** Sending or sent: the answer on its way out can no longer change. */
  disabled?: boolean
  opacity: number
  onPressedChange: (pressed: boolean) => void
  onPress: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  const [pressed, setPressed] = useState(false)
  const press = (down: boolean): void => {
    setPressed(down)
    onPressedChange(down)
  }
  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: ASK_ROW_RADIUS,
        opacity
      }}
      onPress={onPress}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
    >
      <RowMark number={number} selected={selected} pressed={pressed} multi={multi === true} />
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ color: pressed ? colors.askText : colors.askLabel }}>
          {notificationPlainText(label)}
        </Txt>
        {description ? (
          <Txt variant="label" style={{ color: colors.askMuted }}>
            {notificationPlainText(description)}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  )
}

/** The last row: the free answer is a field in the row, with the Claude app's
 *  placeholder, not a row that opens a field (dc5.java:1562-1720). */
export function OtherRow({
  value,
  selected,
  multi,
  disabled,
  opacity,
  isLast,
  inputRef,
  onPressedChange,
  onChangeText,
  onSubmit
}: {
  value: string
  selected: boolean
  multi: boolean
  disabled: boolean
  opacity: number
  isLast: boolean
  inputRef: React.RefObject<TextInput | null>
  onPressedChange: (pressed: boolean) => void
  onChangeText: (value: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const { colors, fonts, type } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: ASK_ROW_RADIUS,
        opacity,
        // The row is filled while its field has focus (dc5.java:1612-1620: ad5.P(), else clear).
        backgroundColor: focused ? colors.askBadge : 'transparent'
      }}
      onPress={() => inputRef.current?.focus()}
      onPressIn={() => onPressedChange(true)}
      onPressOut={() => onPressedChange(false)}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
    >
      <RowMark number={null} selected={selected} pressed={false} multi={multi} />
      <TextInput
        ref={inputRef}
        cursorColor={colors.caret}
        style={{
          flex: 1,
          padding: 0,
          color: colors.askText,
          fontFamily: fonts.regular,
          fontSize: Math.max(type.body.size, TEXT_INPUT_FONT_SIZE),
          lineHeight: Math.round(Math.max(type.body.size, TEXT_INPUT_FONT_SIZE) * 1.4)
        }}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        placeholder={ASK_OTHER_LABEL}
        placeholderTextColor={colors.askMuted}
        selectionColor={colors.accent}
        // Android draws its own underline through the field.
        underlineColorAndroid="transparent"
        // Next on a page that has a next one, Done on the last (dc5.java:1665).
        returnKeyType={isLast ? 'done' : 'next'}
        multiline
        submitBehavior="submit"
        onSubmitEditing={onSubmit}
        accessibilityLabel={ASK_OTHER_LABEL}
      />
    </Pressable>
  )
}
