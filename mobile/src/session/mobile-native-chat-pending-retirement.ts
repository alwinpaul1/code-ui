import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countImageSourceTurnsAfter,
  normalizeReconcileText,
  normalizedUserText
} from './mobile-native-chat-draft-reconcile'
import { isTakenSend, type MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { rowWillNamePastedPhotos } from './mobile-native-chat-photo-rows'

const SPACE = ' '
/** How long before, and after, the phone saw a taken send leave the queue box
 *  a row of its text may be stamped and be the row Claude wrote as it dequeued
 *  it. Claude writes that row as the prompt leaves the queue, and the phone
 *  sees the box without it only at a later screen read (one a second, each
 *  given 2.5 s, over the relay), so the row leads by up to that; it trails
 *  only by however far the phone's clock runs behind the desktop's. */
const DEQUEUED_ROW_LEADS_MS = 10_000
const DEQUEUED_ROW_TRAILS_MS = 1_000
const NO_PENDING_IDS: ReadonlySet<string> = new Set()
// Slack the cursor slide may spend re-trying later start positions, on top of
// one free pass over the run. Nothing bounds how many sends accumulate on the
// agent's input line — that ends when the agent accepts input again — so the
// budget must never truncate a genuine glue: the first attempt covers the whole
// run and always fits. It only stops a run of identical prefix-matching sends
// from making the scan quadratic.
export const GLUE_SLIDE_BUDGET = 8

type UserTurn = { index: number; text: string }
type GlueSegment = { text: string; tail: number } | null

/** Pending ids represented by post-send transcript rows that glued adjacent sends. */
export function selectGluedPendingIds(
  messages: readonly NativeChatMessage[],
  pending: readonly MobileNativeChatPendingMessage[],
  excludedPendingIds: ReadonlySet<string> = NO_PENDING_IDS,
  /** Image echoes whose local preview has been rebound onto its transcript row.
   *  Until that happens an image echo must stay put, so it is not a glue segment. */
  reboundImagePendingIds: ReadonlySet<string> = NO_PENDING_IDS
): ReadonlySet<string> {
  const retired = new Set<string>()
  if (pending.length < 2) {
    return retired
  }
  const messageIndexById = new Map<string, number>()
  const turns: UserTurn[] = []
  for (const [index, message] of messages.entries()) {
    messageIndexById.set(message.id, index)
    const text = normalizedUserText(message)
    if (text) {
      turns.push({ index, text })
    }
  }
  const segments: GlueSegment[] = pending.map((item) => {
    const text = normalizeReconcileText(item.text)
    const tail =
      item.baselineTailMessageId === null
        ? -1
        : (messageIndexById.get(item.baselineTailMessageId) ?? null)
    // An image send glues onto the input line like any other, so once its preview is
    // rebound its text is a real segment of the resulting row. While it is still
    // unbound it stays a barrier: retiring it early would drop the phone-local photo,
    // which the transcript's host path cannot render.
    const unboundImage = Boolean(item.images?.length) && !reboundImagePendingIds.has(item.id)
    return excludedPendingIds.has(item.id) ||
      !item.baselineResolved ||
      unboundImage ||
      text === '' ||
      tail === null
      ? null
      : { text, tail }
  })

  // Barriers preserve original adjacency after exact landings retire.
  let runStart = 0
  while (runStart < pending.length) {
    while (runStart < pending.length && segments[runStart] === null) {
      runStart += 1
    }
    let runEnd = runStart
    while (runEnd < pending.length && segments[runEnd] !== null) {
      runEnd += 1
    }
    let cursor = runStart
    for (const turn of turns) {
      if (cursor >= runEnd - 1) {
        break
      }
      // A send that can never match must not freeze the run behind it. One
      // permanently unretirable head — a pair whose own glued row arrived with
      // the read, or a send the count pass claimed against an older row — would
      // otherwise disable glue retirement for every later pair, for the rest of
      // the session. Slide past it; the cursor stays monotonic, so a later turn
      // can never claim a send an earlier one already took.
      let budget = runEnd - runStart + GLUE_SLIDE_BUDGET
      let start = cursor
      let matched = 0
      for (; start <= runEnd - 2 && budget > 0; start++) {
        const attempt = matchGluedRun(turn, segments, start, runEnd)
        budget -= attempt.inspected
        matched = attempt.matched
        if (matched > 0) {
          break
        }
      }
      if (matched === 0) {
        continue
      }
      for (let index = start; index < start + matched; index++) {
        retired.add(pending[index]!.id)
      }
      cursor = start + matched
    }
    runStart = runEnd + 1
  }
  return retired
}

/** Length of the exact glued run at `start`, plus the segments it had to read. */
function matchGluedRun(
  turn: UserTurn,
  segments: readonly GlueSegment[],
  start: number,
  end: number
): { matched: number; inspected: number } {
  let at = 0
  let matched = 0
  let inspected = 0
  for (let index = start; index < end; index++) {
    const segment = segments[index]!
    inspected += 1
    // Every send carries its OWN boundary: a row that already existed when this
    // send was issued can never be part of its echo, however well it reads.
    if (turn.index <= segment.tail) {
      return { matched: 0, inspected }
    }
    if (at > 0 && turn.text[at] === SPACE) {
      at += 1
    }
    if (!turn.text.startsWith(segment.text, at)) {
      return { matched: 0, inspected }
    }
    at += segment.text.length
    matched += 1
    if (at === turn.text.length) {
      // A lone exact match is an ordinary landing, which the count pass owns.
      return { matched: matched > 1 ? matched : 0, inspected }
    }
  }
  return { matched: 0, inspected }
}

/** Retires exact and glued transcript landings while preserving pending order. */
/**
 * A witnessed echo the SCREEN cut short, retired by the row it is a prefix of.
 *
 * A terminal too narrow to print a prompt truncates it and marks the cut with an
 * ellipsis. The screen parser refuses to make new stubs now, but one already
 * written to disk comes back on every launch, and the exact-text pass above can
 * never retire it: a prefix is not an equal. It sat on the device as a bubble
 * reading "…utilise the entire spac…", pinned above the next prompt with the
 * reply missing between them, and it survived reinstalling the app
 * (2026-09-15).
 *
 * The stem must be a real prefix of a LONGER landed row. That does mean a stub
 * can be claimed by a different message that happens to start the same way —
 * pinned as a deliberate limit in the test. Retiring a duplicate that would
 * otherwise never go away is worth more than holding a stub for a row that may
 * never come.
 */
function stubLanded(
  id: string,
  text: string,
  landedCounts: ReadonlyMap<string, number>
): boolean {
  const key = normalizeReconcileText(text)
  // A reading the screen CUT ends in an ellipsis. A reading taken from the `❯`
  // row of a prompt that WRAPPED ends at no marker at all — it is simply the
  // first row. Both are prefixes of the row that lands, and both must give way
  // to it, or the message draws twice for the rest of the session (2026-09-15).
  //
  // WITNESSED readings only. The phone's own sends are routinely prefixes of a
  // row too — that is exactly what glue is, several sends landing as one row —
  // and retiring the first of those early breaks the glue pass
  // (mobile-native-chat-pending-retirement.test.ts caught it).
  const witnessed = id.startsWith('queued-') || id.startsWith('absorbed-') || id.startsWith('desk-')
  if (!witnessed && !key.endsWith('…')) {
    return false
  }
  const stem = (key.endsWith('…') ? key.slice(0, -1) : key).trimEnd()
  if (stem === '') {
    return false
  }
  for (const landed of landedCounts.keys()) {
    if (landed.length > stem.length && landed.startsWith(stem)) {
      return true
    }
  }
  return false
}

/**
 * A witnessed echo the screen glued the AGENT'S reply onto, retired by the
 * prompt it was built from.
 *
 * The screen reader takes a prompt's wrapped rows by their two-space indent, and
 * the agent's own prose sits on rows of exactly that shape. Nothing visible
 * tells them apart, so a reply can be read as more of the message. The result
 * matched no transcript row, could never retire, and left the agent's words
 * attributed to the user — reported with a screenshot and the word "leaked"
 * (2026-09-15: a bubble ending in the agent's own "session:ok").
 *
 * The real row is a PREFIX of the glued reading, which is the handle. It is
 * deliberately narrow: the row must be a prefix at a word boundary AND the extra
 * text must be long enough to be a reply rather than the rest of a sentence the
 * user actually typed. A user's own longer message is pinned as NOT retired in
 * mobile-native-chat-glued-echo-retirement.ts.
 */
const GLUED_REPLY_MIN_EXTRA = 40

function gluedLanded(text: string, landedCounts: ReadonlyMap<string, number>): boolean {
  const key = normalizeReconcileText(text)
  if (key.length <= GLUED_REPLY_MIN_EXTRA) {
    return false
  }
  for (const landed of landedCounts.keys()) {
    if (landed.length === 0 || landed.length >= key.length) {
      continue
    }
    if (!key.startsWith(landed)) {
      continue
    }
    // At a word boundary, so "fix the parse" never claims "fix the parser".
    const next = key.charAt(landed.length)
    if (next !== '' && !/\s/.test(next)) {
      continue
    }
    if (key.length - landed.length >= GLUED_REPLY_MIN_EXTRA) {
      return true
    }
  }
  return false
}

/** Whether a user row of `key` was stamped as this taken send left the queue
 *  box: the row Claude writes when it dequeues a prompt. Never one stamped
 *  before the send left the phone, which is an older row of the same text
 *  (review, 2026-09-25: "yes" sent idle, then again mid-turn seconds later). */
function dequeuedRowLanded(
  messages: readonly NativeChatMessage[],
  key: string,
  taken: Pick<MobileNativeChatPendingMessage, 'takenAt' | 'sentAt'>
): boolean {
  const takenAt = taken.takenAt
  if (typeof takenAt !== 'number' || !Number.isFinite(takenAt)) {
    return false
  }
  const sentAt = typeof taken.sentAt === 'number' && Number.isFinite(taken.sentAt) ? taken.sentAt : -Infinity
  const from = Math.max(sentAt, takenAt - DEQUEUED_ROW_LEADS_MS)
  return messages.some(
    (message) =>
      message.timestamp !== null &&
      message.timestamp >= from &&
      message.timestamp <= takenAt + DEQUEUED_ROW_TRAILS_MS &&
      normalizedUserText(message) === key
  )
}

export function retireLandedMobileNativeChatPending(
  messages: readonly NativeChatMessage[],
  current: MobileNativeChatPendingMessage[],
  landedImagePendingIds: ReadonlySet<string>
): MobileNativeChatPendingMessage[] {
  const landedCounts = new Map<string, number>()
  for (const message of messages) {
    const text = normalizedUserText(message)
    if (text) {
      landedCounts.set(text, (landedCounts.get(text) ?? 0) + 1)
    }
  }
  const landedPendingIds = new Set<string>()
  // Why a separate set: a barrier preserves adjacency after a landing consumed a whole
  // row. An image landing can share its row with the send glued after it, so treating it
  // as a barrier would strand that send in a run of one and keep its echo forever.
  const exactLandedIds = new Set<string>()
  // How far this pass moves a surviving copy's ordinal (the taken sends below).
  const bumps = new Map<string, number>()
  const ordinalOf = (item: MobileNativeChatPendingMessage) =>
    item.expectedOccurrence + (bumps.get(item.id) ?? 0)
  const bump = (item: MobileNativeChatPendingMessage) => bumps.set(item.id, (bumps.get(item.id) ?? 0) + 1)
  const taken: number[] = []
  for (const [index, item] of current.entries()) {
    if (landedImagePendingIds.has(item.id)) {
      landedPendingIds.add(item.id)
      continue
    }
    // An unresolved baseline has nothing to count against yet — `messages` is not
    // known to be the transcript this send was issued into.
    if (!item.baselineResolved) {
      continue
    }
    if (isTakenSend(item)) {
      taken.push(index)
      continue
    }
    // Image echoes are held back so their local preview can reach the
    // authoritative row first; the transcript's host path cannot render a
    // phone-local photo. But that was the ONLY way out, so when the binding
    // missed the optimistic bubble outlived the real row and the send showed
    // twice, once with the photo and once as text (2026-09-14). A captioned
    // photo whose own row has landed now retires like any other send: the
    // thumbnail is worth less than a duplicate that never goes away. A
    // caption-less photo still waits, since it has no text to be sure by.
    const captioned = item.text.trim() !== ''
    if (item.images?.length && !captioned) {
      continue
    }
    // A photo send made before the read settled, whose own row will name the
    // paths it pasted, retires when that row binds it: its ordinal was counted
    // against another read, so an older row of the same words could retire it
    // first, its photo bound nowhere and its row drawing "Image on Desktop"
    // (review of becd6af2). A send made against a settled read counts its
    // rows as before, which retires one whose row names another path, a resend
    // after "Delivery unconfirmed" (re-review of 4e25d63e).
    if (item.images?.length && item.sentBeforeReadSettled === true && rowWillNamePastedPhotos(item)) {
      continue
    }
    const key = normalizeReconcileText(item.text)
    // A row of its text stamped as a taken send ahead of it left the box is
    // that send's own, dequeued at the end of the turn after all, and the pass
    // below gives it there. Taken by this copy instead, the taken one waited
    // for a second row, and this one, taken mid-turn next, was drawn nowhere
    // (review, 2026-09-25). Judged by the taken send's time, not this copy's:
    // a margin on this copy's send time failed a resend made within it, and a
    // phone clock running ahead lost the first message the other way.
    const deferred = taken.some((earlier) => {
      const other = current[earlier]!
      return normalizeReconcileText(other.text) === key && dequeuedRowLanded(messages, key, other)
    })
    const byCount = captioned && (landedCounts.get(key) ?? 0) >= item.expectedOccurrence && !deferred
    const landed = !captioned
      ? countImageSourceTurnsAfter(messages, item.baselineTailMessageId) >= item.expectedOccurrence
      : byCount || stubLanded(item.id, item.text, landedCounts) || gluedLanded(item.text, landedCounts)
    if (landed) {
      landedPendingIds.add(item.id)
      exactLandedIds.add(item.id)
    }
    if (byCount) {
      // The row went to this copy, whose ordinal leaves out the sends before it
      // the agent took (isTakenSend). So each of those needs one row more.
      for (const earlier of taken) {
        if (normalizeReconcileText(current[earlier]!.text) === key) {
          bump(current[earlier]!)
        }
      }
    }
  }
  // A send the agent took is owed no row, but still leaves on one: Claude may
  // have dequeued it as a queued user row after all, or the queue box only
  // looked empty (a relay drop hands the chat no queue). It takes a row only
  // past the ordinal every copy still waiting has left it, and once it has, every
  // later copy of its text, which left it out, needs one more. The ordinals are
  // kept, so the next pass cannot read the same row for a second copy: the first
  // version sealed a taken send for good instead, and a second copy of its text
  // then drew twice (review, 2026-09-25).
  // A taken send whose own dequeued row landed goes first: of two taken copies
  // of one text, the one the box let go as the turn ended owns that row, not
  // one taken mid-turn minutes before (review, 2026-09-25). The copies either
  // side of a claim left it out of their ordinals, so each needs one more.
  const claim = (index: number): void => {
    const item = current[index]!
    const key = normalizeReconcileText(item.text)
    landedPendingIds.add(item.id)
    exactLandedIds.add(item.id)
    for (const [other, copy] of current.entries()) {
      const leftItOut = other > index || (other < index && isTakenSend(copy))
      if (leftItOut && !landedPendingIds.has(copy.id) && normalizeReconcileText(copy.text) === key) {
        bump(copy)
      }
    }
  }
  const claims = (index: number): boolean => {
    const item = current[index]!
    const key = normalizeReconcileText(item.text)
    return key !== '' && !landedPendingIds.has(item.id) && (landedCounts.get(key) ?? 0) >= ordinalOf(item)
  }
  for (const index of taken) {
    const item = current[index]!
    if (claims(index) && dequeuedRowLanded(messages, normalizeReconcileText(item.text), item)) {
      claim(index)
    }
  }
  for (const index of taken) {
    // The same hold as below for a photo send made before the read settled:
    // an older row of its words would take its only copy away (re-review of
    // 4e25d63e). Its dequeued row, if it gets one, names its paths.
    const item = current[index]!
    const held = item.images?.length && item.sentBeforeReadSettled === true && rowWillNamePastedPhotos(item)
    if (!held && claims(index)) {
      claim(index)
    }
  }
  const glued = selectGluedPendingIds(messages, current, exactLandedIds, landedImagePendingIds)
  if (landedPendingIds.size === 0 && glued.size === 0 && bumps.size === 0) {
    return current
  }
  return current
    .filter((item) => !landedPendingIds.has(item.id) && !glued.has(item.id))
    .map((item) => (bumps.has(item.id) ? { ...item, expectedOccurrence: ordinalOf(item) } : item))
}
