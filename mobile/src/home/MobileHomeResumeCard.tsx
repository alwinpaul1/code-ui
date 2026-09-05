import { ChevronRight, Play } from 'lucide-react-native'
import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import { repoColor } from '../worktree/repo-color'

export function MobileHomeResumeCard(props: {
  card: HomeResumeCard
  onOpen: (card: HomeResumeCard) => void
}) {
  const { colors, radius, space } = useTheme()
  return (
    <PressScale
      accessibilityRole="button"
      disabled={!props.card.actionable}
      pressedScale={0.985}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        opacity: props.card.actionable ? 1 : 0.5
      }}
      onPress={() => props.onOpen(props.card)}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.bgRaised,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: space.md
        }}
      >
        <Play size={18} color={colors.textSecondary} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body" weight="semibold" numberOfLines={1}>
          {props.card.worktree.displayName}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: repoColor(props.card.worktree.repo)
            }}
          />
          <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
            {props.card.worktree.repo}
            {'  ·  '}
            {props.card.worktree.branch}
          </Txt>
        </View>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </PressScale>
  )
}
