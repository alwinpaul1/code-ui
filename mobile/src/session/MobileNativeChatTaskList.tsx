// The mobile half of Orca #19230 (d15a6df22), which shipped desktop-only: the
// plan both agents keep, drawn as a checklist. Before this the phone showed the
// raw JSON of the tool input — one truncated line collapsed, pretty-printed
// open — for the one block in a turn that is meant to be read at a glance.
//
// A revision shows what changed rather than repeating the list, because that is
// the whole content of the second, third and fourth call in a turn. The full
// list stays one tap away.

import { memo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
  Circle,
  CircleCheck,
  CircleDot,
  ChevronDown,
  ChevronRight,
  ListChecks
} from 'lucide-react-native'
import {
  diffNativeChatTaskLists,
  nativeChatTaskLabel,
  type NativeChatTask,
  type NativeChatTaskChange,
  type NativeChatTaskList
} from '../../../src/shared/native-chat-task-list'
import { useTheme } from '../theme/theme-context'
import { useTaskListStyles, type TaskListStyles } from './mobile-native-chat-task-list-styles'

const CHANGE_VERB: Record<NativeChatTaskChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  started: 'Started',
  completed: 'Completed',
  pending: 'Marked pending:',
  updated: 'Updated'
}

function changeLabel(change: NativeChatTaskChange): string {
  const subject = change.kind === 'updated' ? nativeChatTaskLabel(change.task) : change.task.content
  return `${CHANGE_VERB[change.kind]} ${subject}`
}

function statusColor(
  status: NativeChatTask['status'],
  colors: { success: string; text: string; textMuted: string }
): string {
  if (status === 'completed') {
    return colors.success
  }
  return status === 'in_progress' ? colors.text : colors.textMuted
}

function TaskRow({
  task,
  label,
  styles
}: {
  task: NativeChatTask
  /** Set when the row is reporting a change rather than the step itself. */
  label?: string
  styles: TaskListStyles
}): React.JSX.Element {
  const { colors } = useTheme()
  const tint = statusColor(task.status, colors)
  const Icon =
    task.status === 'completed' ? CircleCheck : task.status === 'in_progress' ? CircleDot : Circle
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Icon size={12} color={tint} strokeWidth={2} />
      </View>
      <Text
        testID="task-list-row"
        style={[
          styles.task,
          task.status === 'completed' && styles.taskDone,
          task.status === 'in_progress' && styles.taskActive
        ]}
      >
        {label ?? nativeChatTaskLabel(task)}
      </Text>
    </View>
  )
}

function Checklist({
  list,
  styles
}: {
  list: NativeChatTaskList
  styles: TaskListStyles
}): React.JSX.Element {
  if (list.tasks.length === 0) {
    return <Text style={styles.explanation}>No tasks</Text>
  }
  return (
    <>
      {list.tasks.map((task, index) => (
        <TaskRow key={`${task.content}:${index}`} task={task} styles={styles} />
      ))}
    </>
  )
}

/** The full list behind a disclosure, for a revision that already said what
 *  changed. Collapsed by default: the changes are the news, the list is not. */
function FullList({
  list,
  styles
}: {
  list: NativeChatTaskList
  styles: TaskListStyles
}): React.JSX.Element {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <Pressable
        style={styles.disclosure}
        onPress={() => setOpen((value) => !value)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Chevron size={12} color={colors.textMuted} strokeWidth={2} />
        <Text style={styles.disclosureLabel}>Full task list</Text>
      </Pressable>
      {open ? <Checklist list={list} styles={styles} /> : null}
    </>
  )
}

export const MobileNativeChatTaskList = memo(function MobileNativeChatTaskList({
  list,
  previous,
  presentation = 'inline'
}: {
  list: NativeChatTaskList
  previous?: NativeChatTaskList
  presentation?: 'inline' | 'composer'
}): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useTaskListStyles()
  const completed = list.tasks.filter((task) => task.status === 'completed').length
  const [composerOpen, setComposerOpen] = useState(false)
  if (presentation === 'composer') {
    const Chevron = composerOpen ? ChevronDown : ChevronRight
    return (
      <View style={styles.composer} testID="composer-task-progress">
        <Pressable
          style={styles.composerTrigger}
          onPress={() => setComposerOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: composerOpen }}
          accessibilityLabel={`${completed} of ${list.tasks.length} tasks completed`}
        >
          <ListChecks size={13} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.title}>Tasks</Text>
          <Text style={styles.progress}>{`${completed}/${list.tasks.length}`}</Text>
          <Chevron size={12} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
        {composerOpen ? (
          <ScrollView style={styles.composerBody} nestedScrollEnabled>
            <Checklist list={list} styles={styles} />
            {list.explanation ? <Text style={styles.explanation}>{list.explanation}</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    )
  }
  const changes = previous ? diffNativeChatTaskLists(previous, list) : null
  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <ListChecks size={13} color={colors.textMuted} strokeWidth={2} />
        <Text style={styles.title}>Tasks</Text>
        <Text
          style={styles.progress}
          accessibilityLabel={`${completed} of ${list.tasks.length} tasks completed`}
        >
          {`${completed}/${list.tasks.length}`}
        </Text>
      </View>
      {changes ? (
        <>
          {changes.length > 0 ? (
            changes.map((change, index) => (
              <TaskRow
                key={`${change.kind}:${index}`}
                task={change.task}
                label={changeLabel(change)}
                styles={styles}
              />
            ))
          ) : (
            <Text style={styles.explanation}>Tasks unchanged</Text>
          )}
          <FullList list={list} styles={styles} />
        </>
      ) : (
        <Checklist list={list} styles={styles} />
      )}
      {list.explanation ? <Text style={styles.explanation}>{list.explanation}</Text> : null}
    </View>
  )
})
