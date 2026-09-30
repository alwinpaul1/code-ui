import { ChevronRight, ListTodo } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'

const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

/** The caption while the desktop's task sources are unread: nothing is claimed before they are. */
export const TASK_SOURCES_CHECKING_LABEL = 'Checking sources…'

function sourcesCaption(providers: TaskProvider[] | undefined): string {
  if (providers === undefined) {
    return TASK_SOURCES_CHECKING_LABEL
  }
  return providers.length > 0
    ? providers.map((provider) => TASK_PROVIDER_LABELS[provider]).join(' · ')
    : 'No task sources connected'
}

export function MobileHomeTasksCard(props: {
  enabled: boolean
  /** Undefined while unread, so no provider is claimed (or offered as an icon) before it is read. */
  providers: TaskProvider[] | undefined
  onOpen: (provider?: TaskProvider) => void
}) {
  const { colors, radius, space } = useTheme()
  const providers = props.providers ?? []
  return (
    <PressScale
      accessibilityRole="button"
      disabled={!props.enabled}
      pressedScale={0.985}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgPanel,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        minHeight: 72,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        opacity: props.enabled ? 1 : 0.5
      }}
      onPress={() => props.onOpen()}
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
        <ListTodo size={18} color={colors.textSecondary} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body" weight="semibold">
          Tasks
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
          {sourcesCaption(props.providers)}
        </Txt>
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: space.sm }}
        accessibilityLabel={providers.map((provider) => TASK_PROVIDER_LABELS[provider]).join(', ')}
      >
        {providers.map((provider) => (
          <Pressable
            key={provider}
            accessibilityRole="button"
            accessibilityLabel={`Open ${TASK_PROVIDER_LABELS[provider]} tasks`}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.bgRaised : 'transparent'
            })}
            onPress={(event) => {
              event.stopPropagation()
              props.onOpen(provider)
            }}
          >
            <TaskProviderLogo provider={provider} size={20} color={colors.textSecondary} />
          </Pressable>
        ))}
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </PressScale>
  )
}
