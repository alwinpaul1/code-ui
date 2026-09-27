import { useThemedStyles } from '../theme/theme-context'
import { PressFeedback, type PressFeedbackProps } from '../ui/PressFeedback'
import { mobileTasksStyles } from './mobile-tasks-legacy-styles'

type TasksPressableProps = Omit<PressFeedbackProps, 'pressedStyle'>

type TasksRowProps = TasksPressableProps & {
  /** This row already rests on `bgRaised` (a selected picker entry), so the
   *  ordinary lift would paint the colour it is already wearing and the press
   *  would be invisible. */
  raised?: boolean
}

/**
 * The tasks surface's two pressable shapes, bound to its styles once so no
 * call site chooses a colour. `taskRowPressed` is the lift the list rows
 * already used, applied to every row, and it follows the live theme like the
 * rest of the surface.
 */

/** A full-width row: an action in a drawer, a picker entry, a file line, a
 *  group header. Lifts to `bgRaised` while the finger is on it, the same
 *  highlight the task list rows have always had. */
export function TasksRow({ raised, ...props }: TasksRowProps) {
  const styles = useThemedStyles(mobileTasksStyles)
  return (
    <PressFeedback
      pressedStyle={raised ? styles.taskRowPressedOnRaised : styles.taskRowPressed}
      {...props}
    />
  )
}

/** A discrete control: a segment, a chip, a save button, an icon button, a
 *  pill. Dims while pressed; a filled control has nowhere to lift to, and a
 *  bordered one reads the dim on its border and label. */
export function TasksButton(props: TasksPressableProps) {
  return <PressFeedback {...props} />
}
