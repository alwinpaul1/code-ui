import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight, Diamond, Terminal } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  backgroundTaskKindLabel,
  backgroundTaskStatusLabel,
  deriveBackgroundTasks,
  type BackgroundTaskHostStatus,
  formatBackgroundTaskElapsed,
  type BackgroundTask
} from './mobile-background-tasks'

/** Finished tasks arrive a page at a time: a long session can hold hundreds,
 *  and a phone sheet that paints them all scrolls forever. */
const FINISHED_PAGE = 10
const TICK_MS = 1000

/** The list of background work Claude Code has in flight and has finished,
 *  read entirely out of the transcript the chat view already holds. Code UI
 *  cannot stop a Claude Code task, so no card carries a stop control. */
export function MobileBackgroundTasksSheet({
  visible,
  messages,
  agentStatus,
  finishedTaskIds,
  onClose
}: {
  visible: boolean
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  finishedTaskIds?: readonly string[]
  onClose: () => void
}) {
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss>
      <MobileBackgroundTasksSheetBody
        messages={messages}
        agentStatus={agentStatus ?? null}
        finishedTaskIds={finishedTaskIds}
      />
    </BottomDrawer>
  )
}

/** The sheet's contents, exported so render tests can mount them without the
 *  drawer's gesture/animation stack. */
export function MobileBackgroundTasksSheetBody({
  messages,
  agentStatus,
  finishedTaskIds
}: {
  messages: readonly NativeChatMessage[]
  agentStatus?: BackgroundTaskHostStatus | null
  finishedTaskIds?: readonly string[]
}) {
  const { space } = useTheme()
  const [now, setNow] = useState(() => Date.now())
  const [runningOpen, setRunningOpen] = useState(true)
  const [finishedOpen, setFinishedOpen] = useState(true)
  const [finishedShown, setFinishedShown] = useState(FINISHED_PAGE)
  // Re-derived on each tick rather than caching elapsed separately: the walk is
  // linear over the loaded window and only runs while the sheet is open, and
  // one source of truth beats a second, staler copy of the same number.
  const { running, finished } = useMemo(
    () => deriveBackgroundTasks(messages, now, agentStatus ?? null, { finishedTaskIds }),
    [agentStatus, finishedTaskIds, messages, now]
  )
  const ticking = running.some((task) => task.startedAt !== null)
  useEffect(() => {
    if (!ticking) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return (
    <Surface rounded="lg" style={{ padding: space.md + 2, gap: space.sm }}>
      <Txt variant="body" weight="medium">
        Background tasks
      </Txt>
      <BackgroundTasksSection
        title="Running"
        open={runningOpen}
        onToggle={() => setRunningOpen((open) => !open)}
      >
        {running.length > 0 ? (
          running.map((task) => <BackgroundTaskCard key={task.id} task={task} />)
        ) : (
          <Txt variant="caption" tone="muted">
            Nothing running.
          </Txt>
        )}
      </BackgroundTasksSection>
      {finished.length > 0 ? (
        <BackgroundTasksSection
          title="Finished"
          count={finished.length}
          open={finishedOpen}
          onToggle={() => setFinishedOpen((open) => !open)}
        >
          {finished.slice(0, finishedShown).map((task) => (
            <BackgroundTaskCard key={task.id} task={task} />
          ))}
          {finished.length > finishedShown ? (
            <LoadMoreFinished onPress={() => setFinishedShown((shown) => shown + FINISHED_PAGE)} />
          ) : null}
        </BackgroundTasksSection>
      ) : null}
    </Surface>
  )
}

function BackgroundTasksSection({
  title,
  count,
  open,
  onToggle,
  children
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { colors, space } = useTheme()
  const heading = count === undefined ? title : `${title} ${count}`
  return (
    <View style={{ gap: space.sm, paddingTop: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${heading}, ${open ? 'collapse' : 'expand'}`}
        onPress={onToggle}
        hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 28 }}
      >
        {open ? (
          <ChevronDown size={16} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={16} color={colors.textSecondary} />
        )}
        <Txt variant="label" weight="medium" tone="secondary">
          {heading}
        </Txt>
      </Pressable>
      {open ? <View style={{ gap: space.sm }}>{children}</View> : null}
    </View>
  )
}

function BackgroundTaskCard({ task }: { task: BackgroundTask }) {
  const { colors, radius, space } = useTheme()
  const elapsed = formatBackgroundTaskElapsed(task.elapsedMs)
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.sm,
        padding: space.sm + 2,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgRaised
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bgSunken
        }}
      >
        {task.kind === 'agent' ? (
          <Diamond size={14} color={colors.accentText} />
        ) : (
          <Terminal size={14} color={colors.textSecondary} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" numberOfLines={2}>
          {task.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="caption" tone="muted">
            {backgroundTaskKindLabel(task.kind)}
          </Txt>
          {task.status === 'running' ? (
            elapsed ? (
              <Txt variant="caption" tone="secondary">
                {elapsed}
              </Txt>
            ) : null
          ) : (
            <Txt
              variant="caption"
              weight="medium"
              tone={task.status === 'failed' ? 'danger' : 'secondary'}
            >
              {backgroundTaskStatusLabel(task.status)}
            </Txt>
          )}
        </View>
      </View>
    </View>
  )
}

function LoadMoreFinished({ onPress }: { onPress: () => void }) {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Load more finished tasks"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 40,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: space.md,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
    >
      <Txt variant="caption" weight="semibold" tone="secondary">
        Load more
      </Txt>
    </Pressable>
  )
}
