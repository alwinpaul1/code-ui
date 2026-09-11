import type { TerminalModes } from '../terminal/terminal-webview-contract'
import type { ConnectionState } from '../transport/types'

export const MOBILE_SESSION_STATUS_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  handshaking: 'Securing',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting',
  'auth-failed': 'Pairing invalid'
}

export const TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY = 64
export const TERMINAL_GESTURE_INPUT_REFILL_PER_SECOND = 120
export const TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS = 16
/**
 * Wheel rows a single flush carries. A TUI repaints once per batch it has
 * received since its last frame, so rows sent faster than it repaints land
 * as multi-row jumps: measured from the user's finger on 2026-09-11 (Galaxy
 * S23 over Orca Relay, Claude Code repainting ~40/s), 24 of 47 repaints moved
 * six or more rows. One row per 16 ms flush is ~60 rows/s — a fling still
 * scrolls a screen in well under a second, but in single-row steps.
 */
export const TERMINAL_GESTURE_INPUT_SEQUENCES_PER_FLUSH = 1
/** Rows a fling may leave waiting; beyond this the finger's extra travel is
 *  ignored rather than scrolling on for seconds after it lifted. */
export const TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES = 96
export const TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS = 250
/**
 * Wheel batches a single terminal may have unanswered at once. A TUI's scroll
 * is a round trip, so pacing batches on the reply makes the repaint cadence
 * the link's RTT: measured 2026-09-11 on a Galaxy S23 over Orca Relay, one
 * batch in flight painted Claude Code in bursts ~410 ms apart. Sixteen 16 ms
 * batches cover a ~250 ms RTT without ever pacing on it; the token bucket
 * above still bounds the rate.
 */
export const TERMINAL_GESTURE_INPUT_MAX_IN_FLIGHT = 16

export function isFileExistsErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('eexist') || normalized.includes('already exists')
}

export function getRepoIdFromMobileWorktreeId(id: string): string {
  // Why: mobile cannot import desktop shared modules in its standalone tsc run,
  // but the runtime worktree id wire format is still `${repoId}::${path}`.
  const separatorIdx = id.indexOf('::')
  return separatorIdx === -1 ? id : id.slice(0, separatorIdx)
}

export function isGestureMouseTrackingMode(
  mode: TerminalModes['mouseTrackingMode'] | undefined
): boolean {
  return mode === 'x10' || mode === 'vt200' || mode === 'drag' || mode === 'any'
}

/** Phone-visible terminals use phone cols. Chat covering the PTY leaves the
 *  desk at desktop width. */
export function mobileVisibleTerminalDisplayMode(
  activeHandle: string | null,
  chatCoveringTerminal: boolean
): 'auto' | 'desktop' | null {
  if (!activeHandle) {
    return null
  }
  return chatCoveringTerminal ? 'desktop' : 'auto'
}

export function isTerminalPhoneDisplayMode(
  handle: string | null,
  terminalModes: ReadonlyMap<string, 'auto' | 'phone' | 'desktop'>
): boolean {
  if (!handle) {
    return false
  }
  const mode = terminalModes.get(handle)
  return mode === undefined || mode === 'auto' || mode === 'phone'
}

export function getActiveTabIdForHandle(
  tabs: ReadonlyArray<{ id: string; type: string; terminal?: string | null }>,
  terminalHandle: string | null
): string | null {
  if (!terminalHandle) {
    return null
  }
  return (
    tabs.find((tab) => tab.type === 'terminal' && tab.terminal === terminalHandle)?.id ??
    terminalHandle
  )
}

export function updateTerminalCwdFromStreamEvent(
  handle: string,
  data: Readonly<Record<string, unknown>>,
  terminalCwd: Map<string, string>
): void {
  if (!('cwd' in data)) {
    return
  }
  if (typeof data.cwd === 'string' && data.cwd.trim().length > 0) {
    terminalCwd.set(handle, data.cwd)
    return
  }
  terminalCwd.delete(handle)
}
