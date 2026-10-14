import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

export type ChatReadingOption<T extends string> = {
  value: T
  label: string
  /** The face the label is drawn in, for a font choice: each option reads as the face it picks
   *  (gd9.java case 23). Absent for the app's own face. */
  face?: string
}

/**
 * One titled choice of several, as a group of radio rows: the title over the options, the chosen
 * one marked. Every colour comes from the live theme, so it follows the reader's appearance
 * setting, light or dark.
 */
export function ChatReadingOptionGroup<T extends string>({
  title,
  options,
  value,
  onChange
}: {
  title: string
  options: readonly ChatReadingOption<T>[]
  value: T
  onChange: (next: T) => void
}) {
  const { colors, space } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={title}>
      <View style={{ paddingTop: space.md, paddingHorizontal: space.lg }}>
        <Txt variant="body" weight="medium">
          {title}
        </Txt>
      </View>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: 48,
              paddingHorizontal: space.lg,
              backgroundColor: pressed ? colors.bgRaised : 'transparent'
            })}
          >
            <View
              testID="chat-reading-radio"
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 2,
                borderColor: selected ? colors.accent : colors.borderStrong,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {selected ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />
              ) : null}
            </View>
            <Txt variant="body" style={option.face ? { fontFamily: option.face } : undefined}>
              {option.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
