import { ChevronLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/theme-context'
import { IconButton } from './IconButton'
import { Txt } from './Txt'

/** Standard top bar: back chevron, title (and optional subtitle), trailing actions. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  trailing,
  large = false
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  backLabel?: string
  trailing?: ReactNode
  /** Large title row below the bar, Claude-app style. */
  large?: boolean
}) {
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
      <View
        style={{
          height: 52,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.sm,
          gap: space.xs
        }}
      >
        {onBack ? (
          <IconButton icon={ChevronLeft} accessibilityLabel={backLabel} onPress={onBack} />
        ) : (
          <View style={{ width: space.sm }} />
        )}
        {!large ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="heading" weight="semibold" numberOfLines={1}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {trailing}
      </View>
      {large ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Txt variant="display" weight="semibold">
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="body" tone="secondary" style={{ marginTop: space.xs }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
