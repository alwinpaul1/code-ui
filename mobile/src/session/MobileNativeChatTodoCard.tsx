import { useRef } from 'react'
import { useBackClaim } from '../navigation/use-back-claim'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Check, X } from 'lucide-react-native'
import type { NativeChatTask, NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import { useTheme } from '../theme/theme-context'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import { todoCardFocusIndex, todoCardTitle, todoPillModel } from './mobile-native-chat-session-bar-model'

// The Claude Android app's todo card (1.261009.20), opened from the todo pill
// and pinned above the composer: "N/M tasks complete" with a close button,
// then every task in the order the agent made them, joined by a thin rail.
// Done is a tinted circle with a check and struck-through text; running is a
// ring a third full (a spinner while the agent works); to do is an empty ring.
// Each row shows the task's own words, never its "-ing" form. Colours are Code
// UI's own theme tokens, so both schemes are right.

const ICON_COLUMN = 24
const SMALL_RING = 16
const ROW_GAP = 20
const CARD_MAX_HEIGHT = 360

const STATE_WORD: Record<NativeChatTask['status'], string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  pending: 'Pending'
}

/** A ring `fraction` full, starting at twelve o'clock. */
export function TodoRing({
  size,
  stroke,
  fraction,
  track,
  fill
}: {
  size: number
  stroke: number
  fraction: number
  track: string
  fill: string
}): React.JSX.Element {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const shown = Math.max(0, Math.min(1, fraction)) * circumference
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
      {shown > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={fill}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${shown} ${circumference}`}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      ) : null}
    </Svg>
  )
}

function TaskIcon({ task, working }: { task: NativeChatTask; working: boolean }): React.JSX.Element {
  const { colors } = useTheme()
  if (task.status === 'completed') {
    return (
      <View
        testID="todo-done-mark"
        style={{
          width: ICON_COLUMN,
          height: ICON_COLUMN,
          borderRadius: ICON_COLUMN / 2,
          backgroundColor: colors.successSoft,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Check size={16} color={colors.success} strokeWidth={2.4} />
      </View>
    )
  }
  if (task.status === 'in_progress' && working) {
    return <ActivityIndicator size="small" color={colors.text} testID="todo-running-spinner" />
  }
  return (
    <TodoRing
      size={SMALL_RING}
      stroke={1.5}
      fraction={task.status === 'in_progress' ? 1 / 3 : 0}
      track={colors.border}
      fill={colors.text}
    />
  )
}

function TaskRow({
  task,
  last,
  working,
  onLayoutY
}: {
  task: NativeChatTask
  last: boolean
  working: boolean
  onLayoutY: (y: number) => void
}): React.JSX.Element {
  const { colors, space } = useTheme()
  const done = task.status === 'completed'
  return (
    <View
      accessible
      accessibilityLabel={`${task.content}, ${STATE_WORD[task.status]}`}
      onLayout={(event) => onLayoutY(event.nativeEvent.layout.y)}
      style={{ flexDirection: 'row', gap: space.sm, paddingBottom: last ? 0 : ROW_GAP }}
    >
      <View style={{ width: ICON_COLUMN, alignItems: 'center' }}>
        <View style={{ height: ICON_COLUMN, alignItems: 'center', justifyContent: 'center' }}>
          <TaskIcon task={task} working={working} />
        </View>
        {last ? null : (
          <View
            testID="todo-rail"
            style={{ position: 'absolute', top: ICON_COLUMN, bottom: 0, width: 1, backgroundColor: colors.border }}
          />
        )}
      </View>
      <Txt
        testID="todo-card-row"
        variant="body"
        tone={done ? 'muted' : task.status === 'pending' ? 'secondary' : 'primary'}
        style={[{ flex: 1, paddingTop: 1 }, done ? { textDecorationLine: 'line-through' } : null]}
      >
        {task.content}
      </Txt>
    </View>
  )
}

export function MobileNativeChatTodoCard({
  list,
  working,
  onClose
}: {
  list: NativeChatTaskList
  /** The agent is working: the running task's ring turns into a spinner. */
  working: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { colors, radius, space } = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const rowY = useRef<number[]>([])
  const scrolled = useRef(false)
  const focus = todoCardFocusIndex(list)

  // Back closes the card, as it does the app's: the device key natively, the
  // shell's key inside the web page (use-back-claim.ts).
  useBackClaim(() => {
    onClose()
    return true
  })

  const model = todoPillModel(list)
  if (!model) {
    return null
  }
  // Opens on the row before the one running (or next to do), so it is in view
  // with the step that led to it.
  const onRowLayout = (index: number, y: number): void => {
    rowY.current[index] = y
    const target = Math.max(0, focus - 1)
    if (!scrolled.current && focus > 0 && index === target) {
      scrolled.current = true
      scrollRef.current?.scrollTo({ y, animated: false })
    }
  }
  return (
    <View
      testID="todo-card"
      style={{
        marginHorizontal: space.md,
        marginBottom: space.xs,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgPanel,
        overflow: 'hidden'
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: space.lg,
          paddingRight: space.sm,
          paddingVertical: space.xs
        }}
      >
        <Txt variant="body" accessibilityRole="header" style={{ flex: 1 }}>
          {todoCardTitle(model)}
        </Txt>
        <IconButton icon={X} accessibilityLabel="Close" variant="ghost" size={36} iconSize={20} onPress={onClose} />
      </View>
      <View style={{ height: 1, marginHorizontal: space.lg, backgroundColor: colors.border }} />
      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: CARD_MAX_HEIGHT }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + space.xs }}
        nestedScrollEnabled
      >
        {list.tasks.map((task, index) => (
          <TaskRow
            key={`${task.content}:${index}`}
            task={task}
            last={index === list.tasks.length - 1}
            working={working}
            onLayoutY={(y) => onRowLayout(index, y)}
          />
        ))}
      </ScrollView>
    </View>
  )
}
