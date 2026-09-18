import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import { PROJECT_SCOPE_ONLY_NOTICE } from './project-config-paths'

/**
 * The chrome all three project-config screens (MCP servers, permission
 * rules, project memory) share: a back button, a title, and the "Project
 * scope only" notice shown once, in plain words, on every one of them.
 *
 * Paints from the live theme (`useTheme`/`useThemedStyles`), never a
 * hardcoded palette — see the project CLAUDE.md's "UI work → ALWAYS handle
 * BOTH light and dark mode": a literal colour here would look identical to
 * the correct version on the phone that wrote it and wrong on every other
 * theme setting forever.
 */
export function ProjectConfigScreenChrome({
  title,
  subtitle,
  headerAction,
  children
}: {
  title: string
  subtitle?: string
  headerAction?: ReactNode
  children: ReactNode
}) {
  const router = useRouter()
  const { colors, space } = useTheme()
  const styles = useThemedStyles(chromeStyles)
  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.surface}>
        <View style={styles.topBar}>
          <IconButton
            icon={ChevronLeft}
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <View style={{ flex: 1, minWidth: 0, marginLeft: space.xs }}>
            <Txt variant="heading" weight="semibold" numberOfLines={1}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {headerAction}
        </View>
        <View style={styles.notice}>
          <Txt variant="caption" tone="secondary">
            {PROJECT_SCOPE_ONLY_NOTICE}
          </Txt>
        </View>
      </SafeAreaView>
      <View style={[styles.body, { backgroundColor: colors.bg }]}>{children}</View>
    </View>
  )
}

function chromeStyles({ colors, space }: Theme) {
  return {
    container: { flex: 1, backgroundColor: colors.bg },
    surface: { backgroundColor: colors.bg },
    topBar: {
      minHeight: 52,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: space.sm
    },
    notice: {
      paddingHorizontal: space.md,
      paddingBottom: space.sm
    },
    body: { flex: 1 }
  }
}
