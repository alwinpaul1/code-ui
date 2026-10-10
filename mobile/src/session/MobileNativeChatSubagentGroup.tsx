import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import {
  formatSubagentTokens,
  nativeChatSubagentGroupHeader,
  sayNativeChatSubagentGroupEnglish as say,
  subagentStateLabel
} from '../../../src/shared/native-chat-subagent-group-header'
import { normalizeSubagentState } from '../../../src/shared/native-chat-subagent-summary'
import { formatNativeChatDuration } from '../../../src/shared/native-chat-turn-status'
import type {
  NativeChatSubagentGroupBlock,
  NativeChatSubagentState
} from '../../../src/shared/native-chat-types'
import { useNow } from '../hooks/use-now'
import { useThemedStyles, type Theme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { AgentRunGlyph } from './MobileNativeChatAgentRunGlyph'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { ShimmerText } from './MobileNativeChatShimmerText'

// Desktop's StatusDot tones: the working and failed states speak; every settled one stays muted.
function stateDotColor(state: NativeChatSubagentState, colors: ThemeColors): ViewStyle {
  switch (state) {
    case 'working':
      return { backgroundColor: colors.text }
    case 'failed':
      return { backgroundColor: colors.danger }
    case 'idle':
      return { backgroundColor: colors.textMuted, opacity: 0.4 }
    case 'completed':
      return { backgroundColor: colors.textMuted, opacity: 0.6 }
    case 'stopped':
    case 'unverifiable':
      return { backgroundColor: colors.textMuted }
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

/** Leaf so the 1 s clock re-renders only the digits, never the row or its message. */
function Elapsed({
  startedAt,
  settledAt,
  counting
}: {
  startedAt: number
  settledAt: number | null
  counting: boolean
}): React.JSX.Element {
  const now = useNow(1_000, counting)
  const end = counting ? now : (settledAt ?? now)
  return <>{formatNativeChatDuration(Math.max(0, (end - startedAt) / 1000))}</>
}

/**
 * One spawn group's row (Orca #26125): how many children work, their settled verdict, how long
 * and how many tokens, with one line per child under it when opened. Live because the host
 * rewrites the roster block in place, and drawn exactly as the journal recorded it — a turn
 * boundary is never evidence a child stopped. It replaces the frozen "Kicked off 2 subagents"
 * sentence the host writes beside the block.
 *
 * Desktop parity is `NativeChatSubagentRun`, from the same shared header; the look is this app's
 * agent run (MobileNativeChatAgentRun): the two-diamond mark, the shimmer while it works, the
 * chevron. A child's own transcript does not open from here, so its line is not a control.
 */
export function MobileNativeChatSubagentGroup({
  block,
  open,
  onToggle,
  styles
}: {
  block: NativeChatSubagentGroupBlock
  /** Held by the transcript, keyed by group, so a remounted list row keeps it. */
  open: boolean
  onToggle?: (groupId: string) => void
  styles: ChatMessageStyles
}): React.JSX.Element | null {
  const own = useThemedStyles(groupStyles)
  const header = nativeChatSubagentGroupHeader(block.agents, say)
  if (header.total === 0) {
    return null
  }
  const { working, headline, verdictState, verdict, alertState, alert, clockStartedAt } = header
  // Spoken whole: a working group's clock would otherwise make the live region re-read the row
  // every second (nested Text spans cannot opt out on their own).
  const settledElapsed =
    !working && clockStartedAt !== null && header.settledAt !== null
      ? formatNativeChatDuration(Math.max(0, (header.settledAt - clockStartedAt) / 1000))
      : null
  const accessibilityLabel = [headline, alert === null ? verdict : `${verdict} +${alert}`, settledElapsed, header.tokens]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const tone = alertState ?? verdictState
  return (
    <View testID="subagent-group" style={styles.toolRun}>
      <View style={styles.toolRunHeader}>
        <Pressable
          style={styles.toolRunToggle}
          onPress={() => onToggle?.(block.groupId)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={accessibilityLabel}
          accessibilityLiveRegion="polite"
        >
          <AgentRunGlyph color={own.mark.color} />
          <ShimmerText
            text={headline}
            active={working}
            color={own.headline.color}
            style={[styles.toolRunLabel, styles.toolRunSentence]}
            numberOfLines={1}
            testID="subagent-group-headline"
          />
          {/* The verdict ellipsizes before the headline or the chevron leaves a phone row. */}
          <Text style={[own.verdict, tone === 'failed' ? own.verdictFailed : null]} numberOfLines={1}>
            {verdict}
            {alert === null ? null : ` +${alert}`}
            {clockStartedAt !== null ? (
              <>
                {' · '}
                <Elapsed startedAt={clockStartedAt} settledAt={header.settledAt} counting={working} />
              </>
            ) : null}
            {header.tokens !== null ? ` · ${header.tokens}` : null}
          </Text>
          <View style={open ? own.caretOpen : undefined}>
            <ChevronRight size={14} color={own.mark.color} strokeWidth={2} />
          </View>
        </Pressable>
      </View>
      {open ? (
        <View style={styles.toolRunBody}>
          {block.agents.map((agent) => {
            const state = normalizeSubagentState(agent.state)
            return (
              <View key={agent.id} testID="subagent-group-entry" style={styles.toolLine}>
                <View style={[own.dot, stateDotColor(state, own.palette)]} />
                <Text
                  style={[styles.toolRunMemberName, own.entryLabel, state === 'idle' ? own.entryLabelIdle : null]}
                  numberOfLines={1}
                >
                  {agent.label}
                </Text>
                <Text style={[styles.toolRunMemberArg, own.entryState]} numberOfLines={1}>
                  {subagentStateLabel(state, 1, 1, say)}
                  {typeof agent.tokens === 'number' ? ` · ${formatSubagentTokens(agent.tokens)}` : null}
                </Text>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

function groupStyles({ colors, fonts }: Theme) {
  return {
    palette: colors,
    ...StyleSheet.create({
      mark: { color: colors.textMuted },
      headline: { color: colors.textSecondary },
      verdict: {
        flex: 1,
        minWidth: 0,
        textAlign: 'right',
        color: colors.textMuted,
        fontFamily: fonts.regular,
        fontSize: 12
      },
      verdictFailed: { color: colors.danger },
      caretOpen: { transform: [{ rotate: '90deg' }] },
      dot: { width: 6, height: 6, borderRadius: 3 },
      entryLabel: { flexShrink: 1 },
      entryLabelIdle: { color: colors.textMuted },
      entryState: { marginLeft: 'auto', flexShrink: 0 }
    })
  }
}
