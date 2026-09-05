import { memo } from 'react'
import { View } from 'react-native'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { agentDisplayLabel, agentDotState, formatTimeAgo } from '../worktree/agent-row-display'
import { AgentStateDot } from './AgentStateDot'
import { MobileAgentIcon } from './MobileAgentIcon'

const INDENT_PER_DEPTH = 14

type Props = {
  agent: RuntimeWorktreeAgentRow
  depth: number
  now: number
  // Bold/foreground until the user has visited the worktree, mirroring desktop's
  // unvisited rule (the workspace title and its agent rows share one signal).
  unvisited: boolean
}

// One inline agent row: state dot → identity → last message/prompt → time ago.
// Mirrors desktop DashboardAgentRow's compact in-card layout.
function WorktreeAgentRowComponent({ agent, depth, now, unvisited }: Props) {
  const { space } = useTheme()
  const dotState = agentDotState(agent, now)
  const label = agentDisplayLabel(agent, now)
  const ts = formatTimeAgo(agent.stateStartedAt, now)

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs + 1,
        marginTop: 4,
        paddingLeft: depth * INDENT_PER_DEPTH
      }}
    >
      <AgentStateDot state={dotState} />
      {/* Agent identity logo (Claude/Codex/…), matching the desktop sidebar's
          agent icons instead of a two-letter text code. */}
      {agent.agentType ? <MobileAgentIcon agentId={agent.agentType} size={13} /> : null}
      <Txt
        variant="caption"
        weight={unvisited ? 'semibold' : 'regular'}
        tone={unvisited ? 'primary' : 'muted'}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {label}
      </Txt>
      <Txt variant="caption" tone="muted">
        {ts}
      </Txt>
    </View>
  )
}

export const WorktreeAgentRow = memo(WorktreeAgentRowComponent)
