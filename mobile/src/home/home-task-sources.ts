import type { TaskProvider } from '../tasks/mobile-task-providers'

/**
 * A desktop whose task source read ended without an answer: a refused round (any of the three
 * reads answered { ok:false }, method_not_found included) or a request that rejected.
 *
 * It is kept apart from "not read yet" (no entry at all). Both used to be no entry, so a read that
 * had already failed drew "Checking sources…" for as long as the desktop stayed connected, a
 * check that was not running (review round 3, 2026-09-30). It is kept apart from a list as well:
 * a failed read claims no source, and never replaces sources an earlier read found.
 */
export const TASK_SOURCES_READ_FAILED = 'read-failed'

/** What Home knows about one desktop's task sources once a read has ended. */
export type HomeTaskSources = TaskProvider[] | typeof TASK_SOURCES_READ_FAILED
