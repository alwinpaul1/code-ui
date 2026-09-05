import { Check, Moon, Smartphone, Sun, type LucideIcon } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import type { ThemePreference } from '../src/theme/tokens'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', hint: 'Follow the phone setting', icon: Smartphone },
  { value: 'light', label: 'Light', hint: 'Cream canvas, ink text', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Charcoal canvas, warm text', icon: Moon }
]

/** Light / Dark / System. The terminal keeps the theme the desktop sends. */
export default function AppearanceSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, preference, setPreference, space } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Appearance" onBack={() => router.back()} large />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl
        }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel style={{ marginTop: space.sm }}>Theme</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }} accessibilityRole="radiogroup">
          {OPTIONS.map((option, index) => {
            const selected = preference === option.value
            const Icon = option.icon
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${option.label}, ${option.hint}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  minHeight: 60,
                  paddingHorizontal: space.lg,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: colors.border,
                  backgroundColor: pressed ? colors.bgRaised : 'transparent'
                })}
                onPress={() => setPreference(option.value)}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.accentSoft : colors.bgRaised
                  }}
                >
                  <Icon
                    size={17}
                    color={selected ? colors.accentText : colors.textSecondary}
                    strokeWidth={2}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="body" weight="medium">
                    {option.label}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {option.hint}
                  </Txt>
                </View>
                {selected ? <Check size={18} color={colors.accentText} strokeWidth={2.5} /> : null}
              </Pressable>
            )
          })}
        </Surface>
        <Txt variant="caption" tone="muted" style={{ marginTop: space.md, paddingHorizontal: space.xs }}>
          Terminals keep the colour theme your desktop sends. Change it in the desktop app.
        </Txt>
      </ScrollView>
    </View>
  )
}
