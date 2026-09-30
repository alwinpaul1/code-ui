import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight, CircleStop } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { BackgroundTask } from './mobile-background-tasks'
import type { WorkflowAgent, WorkflowDetail, WorkflowPhase } from './mobile-background-task-workflows'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  formatAgentCount,
  formatBackgroundTaskElapsed,
  formatTokenCount
} from './mobile-background-task-labels'

/**
 * One Workflow as the Claude app draws it (reference frames 2026-09-30): a
 * status dot and the workflow's name, "Workflow" and the time, the agent
 * count, the description, then a section per phase with a square for each
 * agent and the agent's label.
 *
 * Only what the phone can know is drawn. A running workflow says how many
 * agents are running now, never how many ran: the host's roster drops an agent
 * when it finishes, and carries no phase, tokens or time for one. So there is
 * no done/total, no token figure and no Time column while it runs; the totals
 * appear once the workflow's own completion notification states them.
 */
export function MobileWorkflowCard({ task, onStop }: { task: BackgroundTask; onStop?: (taskId: string) => void }) {
  const { colors, radius, space } = useTheme()
  const detail = task.workflow
  if (!detail) {
    return null
  }
  const running = task.status === 'running'
  const dot = running ? colors.info : task.status === 'failed' ? colors.danger : colors.textMuted
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs ?? detail.usage?.durationMs ?? null)
  const runningAgents = countRunningAgents(detail)
  const usage = detail.usage
  return (
    <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.bgRaised }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
        <Txt variant="body" weight="medium" numberOfLines={2} style={{ flex: 1 }}>
          {task.title}
        </Txt>
        {onStop && running && task.stoppable !== false ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop ${task.title}`}
            onPress={() => onStop(task.id)}
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <CircleStop size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <Facts>
        <Txt variant="caption" tone="secondary">
          {backgroundTaskKindLabel(task.kind)}
        </Txt>
        {running ? null : (
          <Txt variant="caption" tone={task.status === 'failed' ? 'danger' : 'muted'}>
            {backgroundTaskStatusLabel(task.status)}
          </Txt>
        )}
        {elapsed ? (
          <Txt variant="caption" tone="muted">
            {elapsed}
          </Txt>
        ) : null}
      </Facts>
      {running ? (
        runningAgents > 0 ? (
          <Facts>
            <Txt variant="caption" tone="secondary">
              {formatAgentCount(runningAgents, true)}
            </Txt>
          </Facts>
        ) : null
      ) : usage && (usage.agents !== null || usage.tokens !== null) ? (
        <Facts>
          {usage.agents !== null ? (
            <Txt variant="caption" tone="secondary">
              {formatAgentCount(usage.agents)}
            </Txt>
          ) : null}
          {usage.tokens !== null ? (
            <Txt variant="caption" tone="secondary">{`${formatTokenCount(usage.tokens)} tokens`}</Txt>
          ) : null}
        </Facts>
      ) : null}
      {detail.description ? (
        <Txt variant="caption" tone="secondary">
          {detail.description}
        </Txt>
      ) : null}
      {running ? <Phases detail={detail} /> : null}
    </View>
  )
}

function Facts({ children }: { children: React.ReactNode }) {
  const { space } = useTheme()
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>{children}</View>
}

function countRunningAgents(detail: WorkflowDetail): number {
  return (detail.phases ?? []).reduce((sum, phase) => sum + phase.agents.length, detail.otherAgents.length)
}

function Phases({ detail }: { detail: WorkflowDetail }) {
  const { space } = useTheme()
  if (detail.phases === null && detail.otherAgents.length === 0) {
    return null
  }
  return (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      {detail.phases !== null && detail.phases.length > 0 ? (
        <>
          <Txt variant="label" weight="semibold">
            Phases
          </Txt>
          {detail.phases.map((phase) => (
            <PhaseSection key={phase.title} phase={phase} />
          ))}
        </>
      ) : null}
      {detail.otherAgents.length > 0 ? (
        <>
          {detail.phases !== null && detail.phases.length > 0 ? (
            <Txt variant="label" tone="muted">
              Other agents
            </Txt>
          ) : (
            <Txt variant="label" weight="semibold">
              Agents
            </Txt>
          )}
          <AgentRows agents={detail.otherAgents} />
        </>
      ) : null}
    </View>
  )
}

function PhaseSection({ phase }: { phase: WorkflowPhase }) {
  const { colors, space } = useTheme()
  const [open, setOpen] = useState(true)
  const busy = phase.agents.length > 0
  const title = (
    <Txt variant="body" tone={busy ? 'primary' : 'muted'} style={{ flex: 1 }}>
      {phase.title}
    </Txt>
  )
  return (
    <View style={{ gap: space.xs }}>
      {busy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${phase.title}, ${open ? 'collapse' : 'expand'}`}
          onPress={() => setOpen((was) => !was)}
          hitSlop={10}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 }}
        >
          {title}
          <Txt variant="caption" tone="muted">{`${phase.agents.length} running`}</Txt>
          {open ? (
            <ChevronDown size={16} color={colors.textMuted} />
          ) : (
            <ChevronRight size={16} color={colors.textMuted} />
          )}
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 28 }}>{title}</View>
      )}
      {busy ? <Squares count={phase.agents.length} /> : null}
      {busy && open ? <AgentRows agents={phase.agents} /> : null}
    </View>
  )
}

/** One square per running agent. Finished agents have no row on the roster,
 *  so there is no grey square for them: the row is the running ones only. */
function Squares({ count }: { count: number }) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityLabel={formatAgentCount(count, true)}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.info }} />
      ))}
    </View>
  )
}

function AgentRows({ agents }: { agents: WorkflowAgent[] }) {
  const { space } = useTheme()
  return (
    <View style={{ gap: space.xs }}>
      {agents.map((agent) => (
        <Txt key={agent.id} variant="caption" tone="secondary" numberOfLines={1} ellipsizeMode="tail">
          {agent.label ?? 'Unnamed agent'}
        </Txt>
      ))}
    </View>
  )
}
