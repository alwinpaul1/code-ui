import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tapTargetHitSlop } from '../ui/tap-target'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useThemedStyles, type Theme } from '../theme/theme-context'

export type BrowserPointerModifier = 'cmd' | 'ctrl' | 'alt' | 'shift'

const BROWSER_POINTER_MODIFIERS: { id: BrowserPointerModifier; label: string }[] = [
  { id: 'cmd', label: 'Cmd' },
  { id: 'ctrl', label: 'Ctrl' },
  { id: 'alt', label: 'Alt' },
  { id: 'shift', label: 'Shift' }
]

type Props = {
  disabled: boolean
  selectedModifiers: BrowserPointerModifier[]
  onToggle: (modifier: BrowserPointerModifier) => void
}

export function MobileBrowserPointerModifiers({
  disabled,
  selectedModifiers,
  onToggle
}: Props): React.JSX.Element {
  const styles = useThemedStyles(pointerModifierStyles)
  return (
    <View style={styles.modifierRow}>
      {BROWSER_POINTER_MODIFIERS.map((modifier) => {
        const selected = selectedModifiers.includes(modifier.id)
        return (
          <Pressable
            hitSlop={tapTargetHitSlop(styles.keyButton)}
            key={modifier.id}
            style={({ pressed }) => [
              styles.keyButton,
              selected && styles.keyButtonSelected,
              pressed && !selected && styles.keyButtonPressed,
              disabled && styles.disabled
            ]}
            disabled={disabled}
            onPress={() => onToggle(modifier.id)}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${modifier.label} click modifier`}
          >
            <Text
              style={[
                styles.keyButtonText,
                selected && styles.keyButtonTextSelected,
                disabled && styles.disabledText
              ]}
            >
              {modifier.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function pointerModifierStyles({ colors }: Theme) {
  return StyleSheet.create({
    modifierRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs
    },
    keyButton: {
      minHeight: 30,
      minWidth: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      paddingHorizontal: spacing.sm
    },
    keyButtonPressed: {
      backgroundColor: colors.border
    },
    keyButtonSelected: {
      backgroundColor: colors.text
    },
    keyButtonText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontFamily: typography.monoFamily
    },
    keyButtonTextSelected: {
      // On the inverse fill above (`text` used as a bright surface), the label takes the inverse
      // text colour rather than the page's own.
      color: colors.textInverse
    },
    disabled: {
      opacity: 0.35
    },
    disabledText: {
      color: colors.textMuted
    }
  })
}
