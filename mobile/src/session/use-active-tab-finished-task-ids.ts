import { useAgentHudBeacon } from './agent-hud-beacon'

const NONE: readonly string[] = []

/** Background-task ids the active tab's HUD beacon reports finished.
 *
 *  Why the beacon and not the transcript: a task that ends while Claude is
 *  still working is recorded as a queue-operation notification Orca's reader
 *  never surfaces, so without this the row stays "running" until the turn
 *  ends. See `docs/mobile-background-tasks.md`. */
export function useActiveTabFinishedTaskIds(handle: string | null): readonly string[] {
  return useAgentHudBeacon(handle)?.doneTaskIds ?? NONE
}
