import { useMemo } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Play } from 'lucide-react-native'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { formatTimeAgo } from '../worktree/agent-row-display'
import { recentSessionConversationTurns } from '../../../src/shared/ai-vault-session-display'
import {
  AI_VAULT_AGENTS,
  aiVaultAgentLabel,
  type AiVaultAgent,
  type AiVaultSession
} from '../../../src/shared/ai-vault-types'
import type { AgentSessionSearchHit } from './agent-history-search-reply-schema'
import { searchEvidenceRoleLabel, searchSnippetRuns } from './agent-history-search-snippet'
import { agentHistoryStyles } from './agent-history-styles'
import { agentSessionSearchStyles } from './agent-session-search-styles'

// The history list's own preview size (MobileAgentSessionHistoryList.tsx).
const PREVIEW_TURN_LIMIT = 5
const KNOWN_AGENTS = new Set<string>(AI_VAULT_AGENTS)

type Props = {
  hit: AgentSessionSearchHit
  /** The loaded history row for this hit, when the screen has it; it feeds the preview. */
  session: AiVaultSession | null
  expanded: boolean
  now: number
  resume: { disabled: boolean; loading: boolean }
  onPress: () => void
  onResume: (hit: AgentSessionSearchHit) => void
}

/**
 * One search hit, drawn as the history list draws a session: agent icon, title, age, agent and
 * message count, and the same Resume button. What search adds is the evidence line, the turn the
 * match came from with the matched words marked. Tapping the row opens it the way the list does,
 * to the full snippet and the session's recent turns.
 */
export function AgentSessionSearchHitRow({
  hit,
  session,
  expanded,
  now,
  resume,
  onPress,
  onResume
}: Props) {
  const { colors } = useTheme()
  const card = useThemedStyles(agentHistoryStyles)
  const styles = useThemedStyles(agentSessionSearchStyles)
  const updatedAtMs = hit.updatedAt ? Date.parse(hit.updatedAt) : Number.NaN
  const timeAgo = Number.isFinite(updatedAtMs) ? formatTimeAgo(updatedAtMs, now) : ''
  const runs = useMemo(() => (hit.evidence ? searchSnippetRuns(hit.evidence.snippet) : []), [hit])
  const previewTurns = useMemo(
    () => (expanded && session ? recentSessionConversationTurns(session, PREVIEW_TURN_LIMIT) : []),
    [expanded, session]
  )
  const presence = presenceLine(hit.source.presence)
  const resumable = hit.source.presence === 'present'

  return (
    <Pressable
      style={({ pressed }) => [card.card, pressed && card.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={card.cardTopRow}>
        <MobileAgentIcon agentId={hit.agent} size={16} />
        <Text style={card.cardTitle} numberOfLines={1}>
          {hit.title.trim() || 'Untitled session'}
        </Text>
        {timeAgo ? <Text style={card.cardTimeAgo}>{timeAgo}</Text> : null}
      </View>
      {hit.evidence ? (
        <Text style={styles.evidence} numberOfLines={expanded ? undefined : 3}>
          <Text style={styles.evidenceRole}>
            {searchEvidenceRoleLabel(hit.evidence.role)}:{' '}
          </Text>
          {runs.map((run, index) => (
            <Text key={index} style={run.match ? styles.evidenceMatch : undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      ) : (
        <Text style={styles.evidence}>Match in session metadata</Text>
      )}
      {presence ? <Text style={styles.presence}>{presence}</Text> : null}
      <View style={card.cardMetaRow}>
        <Text style={card.cardMetaText}>{agentLabel(hit.agent)}</Text>
        <Text style={card.cardMetaText}>
          {hit.messageCount} {hit.messageCount === 1 ? 'message' : 'messages'}
        </Text>
        {resumable ? (
          <Pressable
            style={({ pressed }) => [
              card.resumeButton,
              resume.disabled && card.resumeButtonDisabled,
              pressed && !resume.disabled && card.resumeButtonPressed
            ]}
            onPress={(event) => {
              event.stopPropagation()
              if (!resume.disabled) {
                onResume(hit)
              }
            }}
            disabled={resume.disabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Resume agent session"
          >
            {resume.loading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Play size={17} color={colors.text} strokeWidth={2.4} />
            )}
          </Pressable>
        ) : null}
      </View>
      {previewTurns.length > 0 ? (
        <View style={card.preview}>
          {previewTurns.map((turn, index) => (
            <View key={`turn-${index}`} style={card.previewTurn}>
              <Text style={card.previewRole}>{turn.role}</Text>
              <Text style={card.previewText}>{notificationPlainText(turn.text)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
}

/** The desktop's words for a transcript the host could not vouch for (AiVaultSearchEvidence). */
function presenceLine(presence: string): string | null {
  switch (presence) {
    case 'present':
      return null
    case 'missing':
      return 'Transcript is no longer available'
    default:
      return 'Transcript availability could not be verified'
  }
}

// The hit's agent is an open string (a newer host knows agents this build does not), so the label
// table is only consulted for names it has.
function agentLabel(agent: string): string {
  return isKnownAgent(agent) ? aiVaultAgentLabel(agent) : agent
}

function isKnownAgent(agent: string): agent is AiVaultAgent {
  return KNOWN_AGENTS.has(agent)
}
