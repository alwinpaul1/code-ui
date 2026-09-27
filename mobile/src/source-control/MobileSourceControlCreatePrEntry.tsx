import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { GitPullRequestArrow } from 'lucide-react-native'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { MobileCreatePrAction } from './mobile-create-pr-action'
import { sourceControlStyles } from './mobile-source-control-styles'

type Props = {
  action: MobileCreatePrAction
}

export function MobileSourceControlCreatePrEntry({ action }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(sourceControlStyles)
  if (!action.visible) {
    return null
  }
  const enabled = !action.disabled
  const copy = action.hint ?? action.label
  return (
    <View style={styles.createPrBlock}>
      <Pressable
        style={({ pressed }) => [
          styles.createPrButton,
          !enabled && styles.createPrButtonDisabled,
          pressed && enabled && styles.createPrButtonPressed
        ]}
        disabled={action.disabled}
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityHint={action.hint}
      >
        {action.loading ? (
          <ActivityIndicator size="small" color={enabled ? colors.bg : colors.textSecondary} />
        ) : (
          <GitPullRequestArrow
            size={16}
            color={enabled ? colors.bg : colors.textSecondary}
            strokeWidth={2.2}
          />
        )}
        <Text
          style={[
            styles.createPrButtonText,
            !enabled && styles.createPrButtonTextDisabled,
            action.hint && styles.createPrButtonHint
          ]}
          numberOfLines={2}
        >
          {copy}
        </Text>
      </Pressable>
    </View>
  )
}
