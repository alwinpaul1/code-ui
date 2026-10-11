import type { ClaudeBackgroundStopTarget } from './claude-background-dialog'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'

/**
 * Which running rows of a terminal-driven Claude tab take a Stop, and what each
 * Stop selects in Claude Code's own Background dialog (claude-background-task-stop.ts).
 *
 * - A shell, the lead's or a subagent's: by its command, which is what the dialog
 *   lists. Claude opens the dialog only from the footer's "N shells" pill, and a
 *   running shell is what puts the pill there.
 * - An agent: by its description, and only while the footer shows a shells pill
 *   (`footerShells` above zero). With none, Claude has no Background dialog to open
 *   from the footer, and its agent panel retitles rows with its own summaries, so
 *   nothing could select the agent reliably: no Stop is drawn rather than a dead one.
 * - Anything else (a monitor, a workflow, a placeholder the phone cannot name): none.
 * - None, either, for a row whose label and kind another row shares while that row
 *   could still be running (running, or `finished`: retired by the footer count, which
 *   retires the OLDEST rows, not necessarily the ones that ended). The dialog would
 *   show one row for both and the Stop could end the other task (review, 2026-10-11).
 *
 * Each running row gets `stoppable` set, true or false; the map holds the targets.
 */
export function terminalStopTargets(
  tasks: BackgroundTasks,
  footerShells: number | null
): { tasks: BackgroundTasks; targets: ReadonlyMap<string, ClaudeBackgroundStopTarget> } {
  const targets = new Map<string, ClaudeBackgroundStopTarget>()
  const shared = new Map<string, number>()
  for (const task of [...tasks.running, ...tasks.finished.filter((row) => row.status === 'finished')]) {
    const key = labelKey(task)
    if (key !== null) {
      shared.set(key, (shared.get(key) ?? 0) + 1)
    }
  }
  const running = tasks.running.map((task): BackgroundTask => {
    const key = labelKey(task)
    const target = key !== null && (shared.get(key) ?? 0) > 1 ? null : targetFor(task, (footerShells ?? 0) > 0)
    if (target) {
      targets.set(task.id, target)
    }
    return { ...task, stoppable: target !== null }
  })
  return { tasks: { ...tasks, running }, targets }
}

function labelKey(task: BackgroundTask): string | null {
  const label = task.stopLabel?.replaceAll(/\s+/g, ' ').trim()
  return label ? `${task.kind}:${label}` : null
}

function targetFor(task: BackgroundTask, pill: boolean): ClaudeBackgroundStopTarget | null {
  const label = task.stopLabel?.trim()
  if (task.status !== 'running' || !label) {
    return null
  }
  if (task.kind === 'shell') {
    return { kind: 'shell', label }
  }
  if (task.kind === 'agent' && pill) {
    return { kind: 'agent', label }
  }
  return null
}
