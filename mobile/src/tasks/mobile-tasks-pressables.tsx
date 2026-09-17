import { PressFeedback, type PressFeedbackProps } from '../ui/PressFeedback'
import { styles } from './mobile-tasks-legacy-styles'

type TasksPressableProps = Omit<PressFeedbackProps, 'pressedStyle'>

/**
 * The tasks surface's two pressable shapes, bound to its legacy palette once
 * so no call site chooses a colour. The surface is a dark island (it paints
 * its own background from the static palette in both schemes), so the
 * themed `alertRowPressed` would be wrong here; `taskRowPressed` is the
 * lift the list rows already used, applied now to every row.
 */

/** A full-width row: an action in a drawer, a picker entry, a file line, a
 *  group header. Lifts to `bgRaised` while the finger is on it, the same
 *  highlight the task list rows have always had. */
export function TasksRow(props: TasksPressableProps) {
  return <PressFeedback pressedStyle={styles.taskRowPressed} {...props} />
}

/** A discrete control: a segment, a chip, a save button, an icon button, a
 *  pill. Dims while pressed; a filled control has nowhere to lift to, and a
 *  bordered one reads the dim on its border and label. */
export function TasksButton(props: TasksPressableProps) {
  return <PressFeedback {...props} />
}
