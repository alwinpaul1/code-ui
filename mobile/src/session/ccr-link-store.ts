import type { CcrEvent } from './ccr-session-api'
import { storeCcrImages } from './ccr-session-cache'
import { bySequence, ccrEventKey } from './ccr-session-link-types'
import { ccrEventDrawsRow, ccrKeptImages, slimCcrEvent, type CcrImageKeeper } from './ccr-transcript-decode'

/**
 * The events one session link holds (ccr-session-link.ts), keyed by message uuid, else event id:
 * a page and the stream that both carry an event hold it once. Pictures are moved to cache files
 * as each event arrives (`slimCcrEvent`), so no base64 is held.
 */
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

  /** Adds events (already slim or not); true when any was new. */
  add(events: readonly CcrEvent[], slim = true): boolean {
    let added = false
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
      added = true
    }
    if (added) {
      this.ordered = [...this.byKey.values()].sort(bySequence)
    }
    return added
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
}
