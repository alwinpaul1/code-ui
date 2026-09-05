import { useEffect, useRef, useState } from 'react'
import {
  InteractionManager,
  Platform,
  Pressable,
  TextInput,
  View,
  type TextInputProps
} from 'react-native'
import { Search, X } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'

// Why: toolbar/list chrome paints and settles after the open tap; native
// autoFocus alone often fails to raise the soft keyboard on iOS/Android.
const SEARCH_AUTO_FOCUS_DELAY_MS = 120

type MobileSearchFieldProps = {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
  onClear?: () => void
  /** Override clear-button visibility (default: value is non-empty). */
  showClear?: boolean
  clearAccessibilityLabel?: string
  autoFocus?: boolean
  /** Re-run delayed focus when this identity changes (e.g. each time search opens). */
  focusKey?: unknown
  returnKeyType?: TextInputProps['returnKeyType']
  onSubmitEditing?: TextInputProps['onSubmitEditing']
  onBlur?: TextInputProps['onBlur']
  editable?: boolean
  accessibilityLabel?: string
}

/**
 * Raised search field used on list screens. Sits above the canvas so it reads
 * as a tappable control instead of chrome that blends into the list.
 */
export function MobileSearchField({
  value,
  onChangeText,
  placeholder,
  onClear,
  showClear,
  clearAccessibilityLabel = 'Clear search',
  autoFocus = false,
  focusKey,
  returnKeyType = 'search',
  onSubmitEditing,
  onBlur,
  editable = true,
  accessibilityLabel
}: MobileSearchFieldProps) {
  const { colors, fonts, radius, space, type } = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)
  const clearVisible = showClear ?? value.length > 0

  useEffect(() => {
    if (!autoFocus || !editable) {
      return
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    // Why: wait for the open-press interaction + layout to finish, then focus
    // so the soft keyboard actually appears (not just a caret with no IME).
    const task = InteractionManager.runAfterInteractions(() => {
      timeout = setTimeout(() => {
        inputRef.current?.focus()
      }, SEARCH_AUTO_FOCUS_DELAY_MS)
    })

    return () => {
      task.cancel()
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }, [autoFocus, editable, focusKey])

  function handleClear() {
    if (onClear) {
      onClear()
    } else {
      onChangeText('')
    }
    // Why: pressing the clear chip steals focus and drops the keyboard;
    // re-focus so the user can keep typing without tapping the field again.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: focused ? colors.borderStrong : colors.border,
        borderRadius: radius.pill,
        paddingLeft: space.md,
        paddingRight: space.xs,
        paddingVertical: Platform.OS === 'ios' ? space.sm : space.xs + 2,
        opacity: editable ? 1 : 0.55
      }}
    >
      <Search
        size={16}
        color={focused ? colors.text : colors.textSecondary}
        strokeWidth={2.2}
      />
      <TextInput
        ref={inputRef}
        style={{
          flex: 1,
          minWidth: 0,
          padding: 0,
          margin: 0,
          color: colors.text,
          fontFamily: fonts.regular,
          fontSize: type.body.size,
          // Why: Android TextInput draws extra vertical padding that misaligns the
          // icon/clear chip unless we zero it out.
          includeFontPadding: false,
          textAlignVertical: 'center'
        }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        // Still request native auto-focus; the delayed ref focus is the reliable path.
        autoFocus={autoFocus}
        showSoftInputOnFocus
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        clearButtonMode="never"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        selectionColor={colors.accent}
      />
      {clearVisible ? (
        <Pressable
          onPress={handleClear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          style={({ pressed }) => ({
            minWidth: 36,
            minHeight: 36,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1
          })}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.textMuted
            }}
          >
            <X size={12} color={colors.bgPanel} strokeWidth={2.6} />
          </View>
        </Pressable>
      ) : null}
    </View>
  )
}
