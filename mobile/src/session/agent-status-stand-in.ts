import { useEffect, useRef } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'

// ─── Orca's title stand-in, and what the task readers read through it ────────
//
// Orca 1.4.216 does not always send the pane's hook row to the phone. Its
// mobile projection (`renewMobileAgentStatusFromPtyTitle` in Orca's
// orca-runtime.ts; the minified `SEa` in the 1.4.216 app.asar, read
// 2026-09-29) puts a status built from the terminal title in its place when
// the title and the row disagree and the title came later, or when the row is
// over 30 minutes old:
//
//   { state, prompt: '', updatedAt, stateStartedAt, paneKey, stateHistory: [],
//     agentType?, terminalHandle?, worktreeId?, tabId?, terminalTitle?,
//     providerSession? }
//
// with the state the title says (`working`, `blocked` for a permission title,
// `done` for anything else). The optional fields are copied from the row it
// replaces. Nothing else: no roster, no working mode.
//
// That can happen at the end of every Claude turn. Claude Code animates its
// title only while a turn loads, and its Stop hooks run inside the turn, so
// the Stop row can reach Orca before the idle title (`✳ …`), and the title's
// flip clears the row's claim on the pane; any later title change does the
// same. When background work runs on, the row says `working`
// (`monitoring` for shells) with the roster, and the phone was sent a `done`
// with no roster instead, for as long as nothing else fired a hook: every shell
// was retired as finished (`done` means every shell has reported, for a hook
// row) and every roster agent left the running count and the sheet. Seen from
// the phone on 2026-09-29: "there are background processes running but the
// chat UI doesn't show that". The same stand-in, `working`, stands over a long
// tool call, and took the roster away mid-turn.
//
// A stand-in speaks for the title, which says whether the lead is generating.
// It says nothing about background work. So the task readers (the running
// count, the tasks sheet, the task memory and the run clock) read the pane's
// last hook row through it, when the phone can know that row still stands:
//
// - The phone watched the pane since that row, with nothing between: the same
//   pane, the link up, the tab list the host's own (not the one the last visit
//   cached). A row that changed the roster while the chat showed another tab,
//   or while the link was down, was never seen, and the stand-in is read as it
//   comes then (the review of b860f0d1 on fix/midturn-residuals).
// - That row is told from a stand-in: it carries a prompt or a history. Orca's
//   headless builder, and its PTY builder when the renderer published none,
//   send hook rows with neither, and there a real "no roster" row has the
//   stand-in's shape (the same review).
// - The stand-in copies the row's identity (one of `terminalHandle`,
//   `worktreeId`, `tabId`, `terminalTitle`; the `done` Orca sends under a
//   shell title once the agent has left copies none) and names the same agent
//   and session.
// - A `done` stand-in says the lead is idle, and the row the phone last saw is
//   often not the Stop row at all: Orca coalesces the phone's tab snapshots
//   (50 ms, at most 250 ms) and builds each from its state at the flush, and
//   every spinner frame restamps the title, so a Stop row becomes a stand-in
//   on the next frame. The row held is then the turn's last TOOL row, which
//   says the lead was working, not what outlived the turn (the review of
//   09aa69a0). So through a `done` the row is read only while Orca says
//   background work outlived the lead's turn: its hook listener stamps
//   `turnCompletedAt` on the row that holds the pane `working` after the
//   lead's Stop (vendored claude-events.ts), and Orca 1.4.216 carries it on
//   the TAB from the live hook row, past its own stand-in, until that row is
//   30 minutes old. With no such stamp the `done` is read as it comes, which
//   is also what retires the work of an agent that exited after a turn that
//   held none (Orca's last resort for a pane with no renderer row,
//   `buildPtyMobileAgentStatus`, is a `done` with the stand-in's exact shape).
//
// Orca 1.4.217 (checked against the v1.4.217 source, 2026-09-30) leaves the stand-in alone: the
// title projection is byte-equal to v1.4.216's and copies no `mainAgent`. What changed is the row
// beside it. Every Claude hook row now carries `mainAgent: {state, outcome?, stateStartedAt}`
// (#22452), the lead's own state before child work is folded into `state`, and reads
// `turnCompletedAt` off that lead record rather than off the Stop event alone, so a child's
// lifecycle row built while the record still holds the stamp carries it too. A cancelled turn
// still earns none (#22476), and a settled lead held open by a WAITING child is stamped as well
// as one held by working children. This file reads none of that yet: it keeps the rules above,
// which stay right for the older hosts it also serves, and `mainAgent` is the field to read next.
//
// Every change to background work fires a hook (a launch is a tool call, an
// agent's end is SubagentStop, a shell's end starts a turn), and a hook row
// newer than the title takes the pane back, so the held row is the host's
// latest word on that work for as long as the phone watches. The chat's other
// readers (the Working row, Stop, the prompt reader) keep the stand-in.
//
// What this cannot see:
// - A row the phone never rendered. The watch is taken per render, so a row
//   applied in the same render as the stand-in after it (a burst after a
//   stalled JS thread), or published while a relay-to-direct cutover replayed
//   the subscription on a link that stayed up, is missed. The older row is
//   read until the next hook row; and when the row missed was the all-clear
//   `done` (Orca stamps that turn's `turnCompletedAt` on it too), until the
//   lead's next turn or the 30 minutes.
// - Whether the agent is still there. An agent that exits after a turn that
//   held background work keeps that work listed until the watch breaks or the
//   30 minutes pass. A silent beacon is no sign of an exit: Claude unmounts
//   its status line, and the beat, under every picker and dialog, and a
//   terminal keeps the last beacon of a process that is long gone (the
//   re-review of 8c71e9fd, which dropped that rule).

/** Every field the title stand-in carries. A status with any other field is a
 *  hook row. */
const STAND_IN_FIELDS: ReadonlySet<string> = new Set([
  'state',
  'prompt',
  'updatedAt',
  'stateStartedAt',
  'paneKey',
  'stateHistory',
  'agentType',
  'terminalHandle',
  'worktreeId',
  'tabId',
  'terminalTitle',
  'providerSession'
])

/** The fields the title stand-in copies from the row it replaces, and the one
 *  Orca sends for a pane whose agent left never carries. */
const COPIED_IDENTITY = ['terminalHandle', 'worktreeId', 'tabId', 'terminalTitle'] as const

type Status = AgentStatusEntry

/** Whether a status has the shape of Orca's title stand-in (see above). A hook
 *  row with no prompt and no history, on a host that sends them so, has it too. */
export function isOrcaStandIn(status: Status): boolean {
  if ((status.prompt ?? '').trim() !== '' || (status.stateHistory?.length ?? 0) > 0) {
    return false
  }
  const fields = status as unknown as Record<string, unknown>
  return Object.keys(fields).every((key) => fields[key] === undefined || STAND_IN_FIELDS.has(key))
}

/** Whether a status is the TITLE's stand-in: the stand-in's shape, with the
 *  row's identity copied. Orca's `done` for a pane its agent left under a
 *  shell title copies none. Loose on type: every field is read at run time. */
export function isTitleStandIn(status: object): boolean {
  const fields = status as Record<string, unknown>
  return isOrcaStandIn(status as Status) && COPIED_IDENTITY.some((key) => fields[key] !== undefined)
}

/** Whether a hook row is told from a stand-in: it carries a prompt or a history. */
function toldFromStandIn(row: Status): boolean {
  return (row.prompt ?? '').trim() !== '' || (row.stateHistory?.length ?? 0) > 0
}

/** What the task readers watched of the active pane: its last hook row. */
export type TaskStatusWatch = { paneKey: string; row: Status | null } | null

/**
 * The status the task readers read, and the watch to keep after it. Pure.
 * `watching`: the link is up and the tab list is the host's own; without it
 * the watch is dropped, since anything could have changed unseen.
 * `turnCompletedAt`: the tab's, Orca's word that the lead's turn ended while
 * background work kept the pane `working`; null when the tab has none.
 */
export function readTaskStatus(
  watch: TaskStatusWatch,
  status: Status | null,
  watching: boolean,
  turnCompletedAt: number | null = null
): { read: Status | null; watch: TaskStatusWatch } {
  if (!watching || status === null || !status.paneKey) {
    return { read: status, watch: null }
  }
  const samePane = watch !== null && watch.paneKey === status.paneKey
  const row = samePane ? watch.row : null
  if (!isOrcaStandIn(status)) {
    return { read: status, watch: samePane && row === status ? watch : { paneKey: status.paneKey, row: status } }
  }
  const kept = row !== null && rowStandsThrough(row, status, turnCompletedAt) ? row : null
  return { read: kept ?? status, watch: samePane ? watch : { paneKey: status.paneKey, row: null } }
}

function rowStandsThrough(row: Status, standIn: Status, turnCompletedAt: number | null): boolean {
  const copied = standIn as unknown as Record<string, unknown>
  return (
    toldFromStandIn(row) &&
    COPIED_IDENTITY.some((key) => copied[key] !== undefined) &&
    row.agentType === standIn.agentType &&
    (row.providerSession?.id ?? null) === (standIn.providerSession?.id ?? null) &&
    (standIn.state !== 'done' || turnCompletedAt !== null)
  )
}

/**
 * The chat's status as the task readers read it: the pane's last hook row
 * while Orca stands in its title, when that row still stands (see above).
 * The watch is a ref written only in the effect after the render that saw a
 * row, so a render reads what a committed render saw, never a value mutated
 * outside React; a render React throws away changes nothing.
 */
export function useTaskReaderStatus(
  status: Status | null,
  watching: boolean,
  turnCompletedAt: number | null = null
): Status | null {
  const watchRef = useRef<TaskStatusWatch>(null)
  const { read, watch } = readTaskStatus(watchRef.current, status, watching, turnCompletedAt)
  useEffect(() => {
    watchRef.current = watch
  }, [watch])
  return read
}
