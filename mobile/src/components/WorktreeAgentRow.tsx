import { memo } from 'react'
import { View } from 'react-native'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat-visual-directive'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  agentDisplayLabel,
  agentRowTimeAt,
  formatTimeAgo
} from '../worktree/agent-row-display'
import { claudeAgentDotState } from '../worktree/claude-session-list-filter'
import { freshCcrSessionFactsForPane } from '../session/ccr-session-facts'
import { CCR_SESSION_WRITES } from '../session/ccr-session-writes'
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
  const { colors, space } = useTheme()
  // A Claude row reads its tab's Anthropic session too (claude-session-list-filter.ts); every
  // other agent keeps Orca's dot.
  const dotState = claudeAgentDotState(agent, now)
  // The Claude app's "Unread" mark (`ccr_session_unread`), only while mark_read is on as well:
  // without it the mark would stay on a session the user has just read here.
  const unread =
    CCR_SESSION_WRITES &&
    agent.agentType === 'claude' &&
    freshCcrSessionFactsForPane(agent.paneKey, now)?.unread === true
  // A visual line renders only in the transcript; the row shows the words around it, and a reply
  // that is only a visual falls back like an empty one (Orca #26071).
  const reply = agent.lastAssistantMessage
  const label = agentDisplayLabel(
    reply ? { ...agent, lastAssistantMessage: withoutNativeChatVisualDirectiveLines(reply) } : agent,
    now
  )
  const ts = formatTimeAgo(agentRowTimeAt(agent), now)

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
      {unread ? (
        <View
          accessibilityLabel="Unread"
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }}
        />
      ) : null}
    </View>
  )
}

export const WorktreeAgentRow = memo(WorktreeAgentRowComponent)
