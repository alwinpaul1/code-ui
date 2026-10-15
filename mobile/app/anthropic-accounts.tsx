import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { tapTargetHitSlop } from '../src/ui/tap-target'
import { spacing } from '../src/theme/mobile-theme'
import { useTheme, useThemedStyles } from '../src/theme/theme-context'
import { voiceSettingsStyles } from '../src/components/voice-settings-styles'
import { AnthropicAccountsSection } from '../src/components/AnthropicAccountsSection'

// Anthropic sign-in used to sit under Voice settings. It matters for far more than dictation now
// (session matching, the model pill, usage, sending), so it has its own screen under Settings.
export default function AnthropicAccountsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(voiceSettingsStyles)

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          hitSlop={tapTargetHitSlop(styles.backButton)}
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Anthropic accounts</Text>
      </View>

      {/* keyboardShouldPersistTaps: the paste-the-code field is a TextInput in this scroller. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AnthropicAccountsSection />
      </ScrollView>
    </View>
  )
}
