import type { BackgroundTask, BackgroundTaskKind } from './mobile-background-tasks'
import { backgroundTaskKindLabel } from './mobile-background-task-labels'

export type BackgroundTaskGroup = {
  kind: BackgroundTaskKind
  /** Plural section title with the count, e.g. "Shells · 4", "Agents · 2". */
  heading: string
  tasks: BackgroundTask[]
}

// Shells and agents are different kinds of background work and the phone shows
// them apart, the way Claude Code's footer separates "· N shells" from its
// agents (user's instruction 2026-09-14). This is the order the groups appear.
const KIND_ORDER: readonly BackgroundTaskKind[] = ['shell', 'agent', 'monitor', 'workflow', 'unknown']

function pluralHeading(kind: BackgroundTaskKind, count: number): string {
  const label = backgroundTaskKindLabel(kind)
  const plural = count === 1 ? label : `${label}s`
  return `${plural} · ${count}`
}

/** Split running tasks into per-kind groups so shells and agents render as
 *  their own labelled sections. Only kinds that are present appear, in a stable
 *  order; a single kind still gets its heading so the count is always explicit. */
export function groupRunningTasksByKind(
  running: readonly BackgroundTask[]
): BackgroundTaskGroup[] {
  const byKind = new Map<BackgroundTaskKind, BackgroundTask[]>()
  for (const task of running) {
    const bucket = byKind.get(task.kind)
    if (bucket) {
      bucket.push(task)
    } else {
      byKind.set(task.kind, [task])
    }
  }
  const groups: BackgroundTaskGroup[] = []
  for (const kind of KIND_ORDER) {
    const tasks = byKind.get(kind)
    if (tasks && tasks.length > 0) {
      groups.push({ kind, heading: pluralHeading(kind, tasks.length), tasks })
    }
  }
  return groups
}
