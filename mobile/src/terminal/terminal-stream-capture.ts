/**
 * A recorded terminal stream: the snapshot the host serialized for a phone
 * viewport, then every chunk with its arrival offset. Written by
 * scripts/capture-terminal-stream.ts; the app/ghostty-spike.tsx replay harness that
 * used it was removed from the shipping app after Stage 0 (2026-09-11).
 */
export type TerminalStreamCaptureEvent =
  | { t: number; type: 'data'; chunk: string }
  | {
      t: number
      type: 'resized'
      cols: number | null
      rows: number | null
      serialized: string | null
    }

export type TerminalStreamCapture = {
  version: 1
  /** True for the committed stand-in that only keeps the build green. */
  placeholder: boolean
  capturedAt: string
  terminal: string
  viewport: { cols: number; rows: number } | null
  /** PTY dims the host reported with the snapshot. */
  cols: number | null
  rows: number | null
  serialized: string
  events: TerminalStreamCaptureEvent[]
}

/**
 * The bytes a replay should init from. A capture whose viewport differed from
 * the host's dims gets a `resized` re-stream right after the snapshot; when
 * that lands before any output it IS the phone-shaped init (Codex's snapshot
 * arrived at 174x67, its re-stream at 51x38), so replay from it.
 */
export function selectTerminalStreamCaptureSnapshot(capture: TerminalStreamCapture): {
  cols: number | null
  rows: number | null
  serialized: string
} {
  const first = capture.events[0]
  if (first && first.type === 'resized' && first.serialized !== null) {
    return { cols: first.cols, rows: first.rows, serialized: first.serialized }
  }
  return { cols: capture.cols, rows: capture.rows, serialized: capture.serialized }
}

export type TerminalStreamReplayTimers = {
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Delivers every data chunk at its recorded offset from the moment `start` is
 * called. Chunks that share a timer tick keep their recorded order; `resized`
 * events are counted, not reproduced — a spike compares engines under output
 * load, and a re-stream would reset the grid mid-measurement.
 */
export function scheduleTerminalStreamReplay(
  events: readonly TerminalStreamCaptureEvent[],
  sink: { write: (chunk: string) => void; done: (summary: { skippedResizes: number }) => void },
  timers: TerminalStreamReplayTimers = globalThis
): { cancel: () => void } {
  const handles: ReturnType<typeof setTimeout>[] = []
  let cancelled = false
  let skippedResizes = 0
  let remaining = 0
  const finish = () => {
    if (!cancelled && remaining === 0) {
      sink.done({ skippedResizes })
    }
  }
  for (const event of events) {
    if (event.type !== 'data') {
      skippedResizes += 1
      continue
    }
    remaining += 1
    handles.push(
      timers.setTimeout(() => {
        if (cancelled) {
          return
        }
        remaining -= 1
        sink.write(event.chunk)
        finish()
      }, Math.max(0, event.t))
    )
  }
  if (remaining === 0) {
    finish()
  }
  return {
    cancel: () => {
      cancelled = true
      for (const handle of handles) {
        timers.clearTimeout(handle)
      }
    }
  }
}

const ESC = ''

/**
 * Port of the injected document's `normalizeInitialData`: a serialized
 * snapshot taken while the alternate screen is active can carry the normal
 * buffer's scrollback before the alt-screen frame, and replaying both into a
 * fresh terminal duplicates TUI frames. Keep only the live alt-screen part.
 */
export function normalizeTerminalSnapshotForReplay(serialized: string): string {
  const on = serialized.lastIndexOf(`${ESC}[?1049h`)
  const off = serialized.lastIndexOf(`${ESC}[?1049l`)
  if (on === -1 || on <= off) {
    return serialized
  }
  return on > 0 ? serialized.slice(on) : serialized
}
