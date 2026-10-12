import { useCallback, useState } from 'react'
import { Keyboard, Pressable, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { tapTargetHitSlop } from '../ui/tap-target'
import {
  diffPillCounts,
  todoPillModel,
  type SessionDiffTotals
} from './mobile-native-chat-session-bar-model'
import { MobileNativeChatTodoCard, TodoRing } from './MobileNativeChatTodoCard'

// The Claude Android app's session bar (1.261009.20): one row of pills above
// the composer. The todo pill, "N/M tasks" beside a ring of how far along the
// plan is (a check once it is all done), opens the todo card in its place. The
// diff pill, "Diff" with the +added -removed lines (each hidden at zero),
// opens the changes. Code UI's own sizes and colours; the app's wording.

const PILL_ICON = 20
const PILL_HEIGHT = 36
// Grown to the 44 dp floor vertically only; the pills sit side by side.
const PILL_HIT_SLOP = tapTargetHitSlop({ minHeight: PILL_HEIGHT })

function BarPill({
  accessibilityLabel,
  accessibilityHint,
  testID,
  onPress,
  children
}: {
  accessibilityLabel: string
  accessibilityHint?: string
  testID: string
  onPress: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={PILL_HIT_SLOP}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        minHeight: PILL_HEIGHT,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : colors.bgPanel
      })}
    >
      {children}
    </Pressable>
  )
}

export function MobileNativeChatSessionBar({
  list,
  diff = null,
  onOpenDiff,
  working = false
}: {
  list: NativeChatTaskList | null
  /** The worktree's uncommitted change; null leaves the diff pill out. */
  diff?: SessionDiffTotals | null
  onOpenDiff?: () => void
  working?: boolean
}): React.JSX.Element | null {
  const { colors, space } = useTheme()
  const [cardOpen, setCardOpen] = useState(false)
  const closeCard = useCallback(() => setCardOpen(false), [])
  const todo = todoPillModel(list)
  // A plan that goes away (/clear, another session in this view) takes the
  // open card with it; the next plan comes up as a pill, not a card nobody opened.
  if (cardOpen && !todo) {
    setCardOpen(false)
  }
  const showDiff = diff !== null && onOpenDiff !== undefined
  if (todo && cardOpen && list) {
    return <MobileNativeChatTodoCard list={list} working={working} onClose={closeCard} />
  }
  if (!todo && !showDiff) {
    return null
  }
  const counts = showDiff ? diffPillCounts(diff) : null
  return (
    <View
      testID="session-bar"
      style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.xs }}
    >
      {todo ? (
        <BarPill
          testID="todo-pill"
          accessibilityLabel={todo.spoken}
          accessibilityHint="Shows the task list"
          onPress={() => {
            Keyboard.dismiss()
            setCardOpen(true)
          }}
        >
          {todo.allDone ? (
            <View
              style={{
                width: PILL_ICON,
                height: PILL_ICON,
                borderRadius: PILL_ICON / 2,
                backgroundColor: colors.successSoft,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Check size={13} color={colors.success} strokeWidth={2.6} />
            </View>
          ) : (
            <TodoRing
              size={PILL_ICON}
              stroke={1.5}
              fraction={todo.completed / todo.total}
              track={colors.border}
              fill={colors.textSecondary}
            />
          )}
          <Txt variant="label" tone="secondary">
            {todo.label}
          </Txt>
        </BarPill>
      ) : null}
      {showDiff && counts ? (
        <BarPill testID="diff-pill" accessibilityLabel="Open diff" onPress={onOpenDiff}>
          <Txt variant="label" tone="secondary">
            Diff
          </Txt>
          {counts.added ? (
            <Txt variant="label" style={{ color: colors.diffAddText }}>
              {counts.added}
            </Txt>
          ) : null}
          {counts.removed ? (
            <Txt variant="label" style={{ color: colors.diffDelText }}>
              {counts.removed}
            </Txt>
          ) : null}
        </BarPill>
      ) : null}
    </View>
  )
}
