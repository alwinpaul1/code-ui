import type { CcrEvent } from './ccr-session-api'
import { storeCcrImages } from './ccr-session-cache'
import { bySequence, CCR_PERSIST_STREAM_MS, ccrEventKey } from './ccr-session-link-types'
import { ccrEventDrawsRow, ccrKeptImages, slimCcrEvent, type CcrImageKeeper } from './ccr-transcript-decode'
import { writeCcrTranscript, type CcrPersistedTranscript } from './ccr-transcript-persist'

/**
 * The events one session link holds (ccr-session-link.ts), keyed by message uuid, else event id:
 * a page and the stream that both carry an event hold it once. Pictures are moved to cache files
 * as each event arrives (`slimCcrEvent`), so no base64 is held.
 */

/** Undrawn (`system`) events a link holds at most: 84% of a session's events draw nothing
 *  (observed live 2026-10-14), and a long-lived stream held every one (review 2026-10-15). */
export const CCR_HELD_UNDRAWN_EVENTS = 200

export class CcrEventStore {
  private readonly byKey = new Map<string, CcrEvent>()
  private readonly keep: CcrImageKeeper
  /** Oldest first, by sequence number. */
  ordered: CcrEvent[] = []
  /** The highest sequence number seen, held or not: the stream resumes after it. */
  lastSequenceNum = 0

  constructor(keep: CcrImageKeeper) {
    this.keep = keep
  }

  /** Adds events (already slim or not); true when any was new and is still held. */
  add(events: readonly CcrEvent[], slim = true): boolean {
    const added: string[] = []
    for (const raw of events) {
      this.seen(raw.sequenceNum)
      const key = ccrEventKey(raw)
      if (!key || this.byKey.has(key)) {
        continue
      }
      const event = slim ? slimCcrEvent(raw, this.keep) : raw
      this.byKey.set(key, event)
      const kept = ccrKeptImages(event)
      if (kept.tool.size + kept.user.size > 0) {
        storeCcrImages(kept.tool, kept.user)
      }
      added.push(key)
    }
    if (added.length === 0) {
      return false
    }
    this.ordered = [...this.byKey.values()].sort(bySequence)
    this.dropOldUndrawn()
    return added.some((key) => this.byKey.has(key))
  }

  /** Undrawn events past the newest CCR_HELD_UNDRAWN_EVENTS go: their sequence number is counted,
   *  and nothing else reads them. A page that brings one back holds it again until the next. */
  private dropOldUndrawn(): void {
    let undrawn = 0
    for (let at = this.ordered.length - 1; at >= 0; at--) {
      const event = this.ordered[at]!
      if (!ccrEventDrawsRow(event) && ++undrawn > CCR_HELD_UNDRAWN_EVENTS) {
        this.byKey.delete(ccrEventKey(event)!)
      }
    }
    if (undrawn > CCR_HELD_UNDRAWN_EVENTS) {
      this.ordered = this.ordered.filter((event) => this.byKey.get(ccrEventKey(event)!) === event)
    }
  }

  seen(sequenceNum: number | null | undefined): void {
    if (sequenceNum != null && sequenceNum > this.lastSequenceNum) {
      this.lastSequenceNum = sequenceNum
    }
  }

  /** The events that draw a row, oldest first. */
  drawing(): CcrEvent[] {
    return this.ordered.filter(ccrEventDrawsRow)
  }

  /** The sequence number of the oldest event that draws a row; null when none does (or none
   *  carries one). */
  oldestDrawingSequence(): number | null {
    for (const event of this.ordered) {
      if (event.sequenceNum != null && ccrEventDrawsRow(event)) {
        return event.sequenceNum
      }
    }
    return null
  }

  /** Whether a row older than `sequence` is held; with `sequence` null, whether any row is. */
  drawsOlderThan(sequence: number | null): boolean {
    for (const event of this.ordered) {
      if (sequence !== null && (event.sequenceNum == null || event.sequenceNum >= sequence)) {
        return false
      }
      if (ccrEventDrawsRow(event)) {
        return true
      }
    }
    return false
  }
}

/** Writes a link's kept copy (ccr-transcript-persist.ts): at once, or once per streamed burst,
 *  CCR_PERSIST_STREAM_MS after its first event (each write trims and sizes the whole copy). The
 *  snapshot is null when nothing may be written (a stopped link). */
export class CcrKeptCopyWriter {
  private readonly timer: (run: () => void, ms: number) => () => void
  private readonly snapshot: () => CcrPersistedTranscript | null
  private cancelPending: (() => void) | null = null

  constructor(timer: (run: () => void, ms: number) => () => void, snapshot: () => CcrPersistedTranscript | null) {
    this.timer = timer
    this.snapshot = snapshot
  }

  write(): void {
    this.cancel()
    const copy = this.snapshot()
    if (copy) {
      writeCcrTranscript(copy)
    }
  }

  soon(): void {
    this.cancelPending ??= this.timer(() => {
      this.cancelPending = null
      this.write()
    }, CCR_PERSIST_STREAM_MS)
  }

  /** A pending burst is written now. */
  flush(): void {
    if (this.cancelPending) {
      this.write()
    }
  }

  /** A pending burst is dropped. */
  cancel(): void {
    this.cancelPending?.()
    this.cancelPending = null
  }
}
