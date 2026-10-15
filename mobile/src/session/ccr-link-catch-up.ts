import type { CcrEvent, CcrEventPage } from './ccr-session-api'
import { CCR_CATCH_UP_PAGES } from './ccr-session-link-types'

/**
 * What a session link that already holds rows (the kept copy, a resume, a truncated stream
 * catch-up) reads before the stream carries single events: the newest pages, landed in ONE change
 * (ccr-session-link.ts `catchUp`). The stream alone replayed the gap one event per frame, and the
 * chat drew it a row at a time while the view followed the tail (the user, 2026-10-15: "it starts
 * to populate and scroll down … see how claude mobile does that and do the same").
 *
 * The Claude app 1.261009.20, decompiled (R8 names, pointers for this build only;
 * docs/claude-app-implementation-notes.md section 9): the session view model seeds its store from
 * an in-memory cache of its last 4 sessions in its constructor (`rs8.b5` reading `tdu`, one
 * `Initialize` with source CacheSeed), so a cached session's first frame has its rows and no
 * loading item (`rs8.Y1`). The connect path then reads the newest page(s) of
 * `…/events?sort_order=desc` (`xjw.b`, "loadLatestPageV2": up to 2 pages of 200) and applies them
 * as ONE `Initialize` that replaces the seed (`sessions/store/a.d`); stream events come after.
 *
 * Here the pages are merged by key when they reach back to what is held, so nothing drawn moves,
 * and replace it, as the app's Initialize does, only when they do not: the gap between them is
 * never drawn as a hole.
 */
export type CcrCatchUp = {
  /** Every event the pages held, newest page first. */
  events: CcrEvent[]
  /** The pages reached back to what is held (or to the history's start). */
  reached: boolean
  /** The cursor before the last page read: where older history continues. */
  nextCursor: string | null
}

/** Reads up to CCR_CATCH_UP_PAGES newest pages, until one reaches the event after `from`. A
 *  failed page throws. */
export async function readCcrCatchUp(read: (cursor: string | null) => Promise<CcrEventPage>, from: number): Promise<CcrCatchUp> {
  const events: CcrEvent[] = []
  let cursor: string | null = null
  for (let count = 0; count < CCR_CATCH_UP_PAGES; count++) {
    const page = await read(cursor)
    events.push(...page.events)
    const oldest = page.events.reduce((min, event) => Math.min(min, event.sequenceNum ?? min), Number.MAX_SAFE_INTEGER)
    if (!page.nextCursor || page.events.length === 0 || oldest <= from + 1) {
      return { events, reached: true, nextCursor: page.nextCursor }
    }
    cursor = page.nextCursor
  }
  return { events, reached: false, nextCursor: cursor }
}
