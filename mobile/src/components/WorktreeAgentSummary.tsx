import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { agentDotState } from '../worktree/agent-row-display'
import { AgentStateDot } from './AgentStateDot'
import { MobileAgentIcon } from './MobileAgentIcon'

const MAX_VISIBLE_AGENTS = 3

type Props = {
  agents: RuntimeWorktreeAgentRow[]
  expanded: boolean
  now: number
  onToggle: () => void
}

export function WorktreeAgentSummary({ agents, expanded, now, onToggle }: Props) {
  const { colors, radius, space } = useTheme()
  const visibleAgents = agents.slice(0, MAX_VISIBLE_AGENTS)
  const hiddenCount = agents.length - visibleAgents.length
  const subject = `${agents.length} agents`

  return (
    <Pressable
      style={({ pressed }) => ({
        minHeight: 26,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingHorizontal: space.xs + 2,
        borderRadius: radius.xs,
        borderWidth: expanded ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: expanded ? 'transparent' : colors.bgRaised,
        opacity: pressed ? 0.7 : 1,
        alignSelf: 'flex-start',
        marginTop: 4
      })}
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${subject}`}
      accessibilityState={{ expanded }}
      onPress={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      {expanded ? (
        <Txt variant="caption" weight="medium" tone="muted" style={{ paddingLeft: space.xs }}>
          {subject}
        </Txt>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {visibleAgents.map((agent) => (
            <View
              key={agent.paneKey}
              style={{
                height: 19,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                paddingHorizontal: 3,
                borderRadius: radius.xs,
                backgroundColor: colors.bgPanel
              }}
            >
              <AgentStateDot state={agentDotState(agent, now)} />
              {agent.agentType ? <MobileAgentIcon agentId={agent.agentType} size={13} /> : null}
            </View>
          ))}
          {hiddenCount > 0 ? (
            <Txt variant="caption" tone="muted">
              +{hiddenCount}
            </Txt>
          ) : null}
        </View>
      )}
      {expanded ? (
        <ChevronDown size={12} color={colors.textMuted} />
      ) : (
        <ChevronRight size={12} color={colors.textMuted} />
      )}
    </Pressable>
  )
}
