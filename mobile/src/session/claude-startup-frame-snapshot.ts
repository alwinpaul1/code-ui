import { readClaudeStartupFrame, type StartupFrameRead } from './claude-startup-frame'

/**
 * The startup frame of a Claude tab whose banner has scrolled off the host's
 * screen, read from the scrollback snapshot the phone receives when it attaches
 * (`{ type: 'scrollback' | 'resized', serialized }`, rpc-client-terminal-binary-frame.ts).
 *
 * What the snapshot is, read from Orca 1.4.222's own bundle (2026-10-08; out/main/index.js
 * `yj`, out/main/chunks/daemon-cgroup-scope-*.js `getSnapshot` and the bundled, patched
 * @xterm/addon-serialize):
 *  - the host's headless xterm (scrollback 5000) serialized with
 *    `serialize({ scrollback: scrollbackRows })`, for a mobile attach with
 *    scrollbackRows 1000, then 500, 250, 100, 25 and 0 until it fits the 512 KiB
 *    budget. So at most the screen plus 1000 rows above it, fewer for a heavy one;
 *  - rows joined by `\r\n`, except a soft-wrapped row, which is joined to the next
 *    with nothing (so a row a phone-fitted host reflowed reads whole again). At a wrap
 *    edge on blank cells it writes `-` cells and erases them again (WRAP_EDGE below);
 *  - a run of blank cells inside a row written as `ESC[nC` (cursor forward), with
 *    `ESC[nX` before it when the blanks carry a background; SGR, OSC 8 links, and at the
 *    end cursor and mode restores (`ESC[r`, `ESC[?6l`, `ESC[y;xH`, `ESC7`, `ESC[?2004h`);
 *  - with the alternate screen active, the normal buffer and the alternate one
 *    concatenated with no separator (`MS`/`jS` strip the `ESC[?1049h` between them), so
 *    such a snapshot is not read at all (noteAttachSnapshot).
 *
 * Every guarantee of `readClaudeStartupFrame` holds: the frame's real shape at column 11,
 * the NEWEST frame only, and no frame inside a reply or tool block. Only the rows that
 * can matter are converted: the rows naming `Claude`, the rows from the oldest such row
 * up to the prompt or block row above it (the reader's upward walk stops there), and the
 * three rows under the newest.
 */

// One escape or control at a time: a CSI (kept only to count a cursor-forward), an OSC
// up to its BEL or ST (or the next ESC, when a cut snapshot lost the terminator), any
// other ESC sequence, a lone ESC, or a C0 control.
// eslint-disable-next-line no-control-regex
const SEQUENCE = /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[ -/]*[0-~])?|[\u0000-\u001f\u007f]/g
/** Wider than any terminal; a malformed `ESC[999999999C` must not build a giant string. */
const MAX_FORWARD = 1024
const HEADER = /Claude Code v\d/
// The reader's upward walk stops at these (claude-startup-frame.ts).
const BOUNDARY = /^\s*[❯⏺⎿]/
const BOUNDARY_GLYPHS = ['❯', '⏺', '⎿']
// The reader's frame spans the header and the three rows under it.
const FRAME_ROWS_BELOW = 3

// The serializer's wrap edge (Orca 1.4.222's patched addon-serialize, `_rowEnd`): for a
// soft-wrapped row that ends in n blank cells it writes n+1 `-`, `ESC[1D ESC[1X`, and for
// n > 0 `ESC[A ESC[<col>C ESC[<n>X ESC[<col>D ESC[B`, so the blanks are erased again and
// the last `-` sits at the start of the next row, erased too. Drawn, that is n blanks.
// eslint-disable-next-line no-control-regex
const WRAP_EDGE = /(-+)\u001b\[1D\u001b\[1X(?:\u001b\[A(?:\u001b\[\d+C)?\u001b\[(\d+)X(?:\u001b\[\d+D)?\u001b\[B)?/g

/** A serialized row as drawn: escapes take no columns, a cursor-forward takes its count. */
function drawnRow(raw: string): string {
  return raw.replace(WRAP_EDGE, (_match, dashes: string, erased: string | undefined) => {
    const blanks = Math.min(erased === undefined ? 0 : Number.parseInt(erased, 10), MAX_FORWARD)
    // Dashes before the serializer's own n+1 are the row's text.
    return dashes.slice(0, Math.max(0, dashes.length - blanks - 1)) + ' '.repeat(blanks)
  }).replace(SEQUENCE, (_match, params: string | undefined, final: string | undefined) => {
    if (final !== 'C') {
      return ''
    }
    const count = Number.parseInt(params ?? '', 10)
    return ' '.repeat(Number.isFinite(count) && count > 0 ? Math.min(count, MAX_FORWARD) : 1)
  })
}

/** Every row of a serialized snapshot as drawn (the tests compare the cheap scan with it). */
export function snapshotRows(serialized: string): string[] {
  return serialized.split('\r\n').map(drawnRow)
}

/**
 * The pair the newest startup frame in an attach snapshot states, or null: no frame, a
 * newest frame that cannot be read, a quoted copy, or an empty or malformed snapshot.
 */
export function startupFrameFromAttachSnapshot(serialized: string): StartupFrameRead | null {
  if (!serialized.includes('Claude')) {
    return null
  }
  const raw = serialized.split('\r\n')
  const drawn = new Map<number, string>()
  const row = (index: number): string => {
    let value = drawn.get(index)
    if (value === undefined) {
      value = drawnRow(raw[index]!)
      drawn.set(index, value)
    }
    return value
  }
  let first = -1
  let last = -1
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index]!.includes('Claude') && HEADER.test(row(index))) {
      first = first === -1 ? index : first
      last = index
    }
  }
  if (first === -1) {
    return null
  }
  let start = first
  while (start > 0) {
    const above = raw[start - 1]!
    start -= 1
    if (BOUNDARY_GLYPHS.some((glyph) => above.includes(glyph)) && BOUNDARY.test(row(start))) {
      break
    }
  }
  const end = Math.min(raw.length, last + FRAME_ROWS_BELOW + 1)
  const rows: string[] = []
  for (let index = start; index < end; index += 1) {
    rows.push(row(index))
  }
  return readClaudeStartupFrame(rows)
}

/** Per terminal handle, the newest attach snapshot not yet read. A snapshot is held,
 *  not scanned, until the chat HUD knows the tab is Claude and which session it shows
 *  (use-mobile-native-chat-hud.ts), and it is scanned once, then let go. */
const pending = new Map<string, string>()
/** A few terminals' worth (each up to the 512 KiB snapshot budget); the oldest goes. */
const PENDING_HANDLES = 8
const listeners = new Set<() => void>()
let version = 0

/**
 * Hold an attach snapshot (`scrollback`, or a `resized` that carries the full buffer) for
 * the HUD to read. An empty one says nothing (a host mid-reflow sends one) and changes
 * nothing. One taken while the alternate screen is up holds the normal rows and the
 * fullscreen ones run together, so it is not held, and it replaces an older one: the
 * terminal has moved on from whatever that showed.
 */
export function noteAttachSnapshot(handle: string, event: Record<string, unknown>): void {
  if ((event.type !== 'scrollback' && event.type !== 'resized') || typeof event.serialized !== 'string' || event.serialized.length === 0) {
    return
  }
  pending.delete(handle)
  if (event.alternateScreen === true) {
    return
  }
  pending.set(handle, event.serialized)
  while (pending.size > PENDING_HANDLES) {
    pending.delete(pending.keys().next().value as string)
  }
  version += 1
  listeners.forEach((listener) => listener())
}

/** The held snapshot for this terminal, handed over once. */
export function takeAttachSnapshot(handle: string): string | null {
  const serialized = pending.get(handle) ?? null
  pending.delete(handle)
  return serialized
}

export function subscribeAttachSnapshots(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Bumped by each held snapshot, for `useSyncExternalStore`. */
export function attachSnapshotVersion(): number {
  return version
}

/** Test-only: a fresh process. */
export function resetAttachSnapshotsForTests(): void {
  pending.clear()
  listeners.clear()
  version = 0
}
