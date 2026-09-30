import { useRef } from 'react'
import {
  queueRowIsPendingSend,
  readingIsJoinedLandedRows
} from './mobile-terminal-queued-messages'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { useStableEchoes } from './use-stable-echoes'
import { preferredWitnessReading, readingGluesToolRowsOnto } from './mobile-native-chat-witness-dedupe'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import {
  normalizeNativeChatUserText,
  stripImagePromptMarker
} from '../../../src/shared/native-chat-image-transcript-markers'

/**
 * Messages the user queued on the DESKTOP, kept on screen after the agent
 * takes them.
 *
 * Why this path exists alongside the prompt hook: Claude Code stores a prompt
 * submitted mid-turn as an `attachment`/`queued_command` record, and Orca's
 * transcript reader drops those, so the message vanishes from the phone the
 * moment the agent absorbs it. The hook fixes that for tabs launched with it,
 * but Claude Code reads `--settings` once at startup — its hot reload watches
 * settings FILES, which Code UI never writes — so a session already running
 * can never gain a hook (anthropics/claude-code#22679, 2026-09-13).
 *
 * The agent draws its own queue on its screen, though, and the phone already
 * parses it. An entry that leaves that list has been absorbed, so it is held
 * here and drawn where it was, until the transcript shows it (a prompt sent
 * while the agent is idle does land as a real user turn) or the tab changes.
 */
/** Queue readings remembered at once: the readings a glued copy is checked
 *  against (`listed`). */
const SIGHTING_CAP = 64

export function useAbsorbedQueueEchoes(
  queued: readonly string[],
  /**
   * WITHDRAWN, and kept in the signature so the decision is visible at the call
   * site rather than silently absent.
   *
   * These were prompts read out of the agent's SCROLLBACK. The reader takes a
   * prompt's wrapped rows by their two-space indent, and the agent's own prose
   * sits on rows of exactly that shape — nothing visible tells them apart. So it
   * glued replies onto messages (a bubble ending in the agent's "session:ok",
   * reported as a leak), lost the paragraph its image rows sat under, and
   * stripped the markers that say an image was sent. Each was fixed in turn;
   * the guessing was the defect.
   *
   * It existed because a prompt queued mid-turn lands only as an
   * `attachment`/`queued_command` record the phone cannot read (verified
   * 2026-09-13). It was then taken to be no longer true, from the `user` rows
   * with `promptSource: "queued"` in the session this was reported from
   * (Claude Code 2.1.272). That was half the record. Those rows are prompts
   * still queued when a turn ENDS, which Claude dequeues as a new turn. A
   * prompt Claude takes MID-turn is still written only as a queued_command,
   * after a queue-operation remove with reason `absorbed_mid_turn`. That same
   * session holds 190 of those beside its 20 queued rows, and this machine
   * holds 1,998 beside 378 across Claude Code 2.1.205 to 2.1.282, or 65 beside
   * 16 on 2.1.280 to 2.1.282 (counted 2026-09-25). The witness stays withdrawn
   * for what it did, guessing a prompt's rows out of prose-shaped screen lines,
   * not for what it was thought to duplicate. A mid-turn message reaches the
   * chat by other copies: the phone's own send (isTakenSend), Orca's hook copy
   * (use-desktop-prompt-echoes.ts), and the queue box below. See
   * mobile-scrollback-prompt-witness.test.ts for the evidence.
   *
   * The QUEUE BOX below is a different witness and is kept: short entries the
   * agent lists for itself, not prose guessed out of its output.
   */
  _sentPrompts: readonly string[],
  folded: readonly NativeChatMessage[],
  scopeKey: string,
  // Anchored on the RAW record, not the folded row: a folded run is one row
  // for the whole turn, so every echo would land on the same boundary and
  // stack (2026-09-13). The raw tail moves with each tool result, which is
  // what puts a "Ran N commands" fold between one prompt and the next.
  rawMessages: readonly NativeChatMessage[] = folded,
  // Prompts already drawn by another path — the phone's own pending echoes
  // and the hook's desktop prompts. The scrollback shows those too, and read
  // blind it drew each of them a second time (2026-09-13).
  ownPrompts: readonly string[] = [],
  // Whether the read behind `queued` could see the box at all
  // (mobile-terminal-queue-read.ts). One that could not is unknown, not
  // empty: the box is taken to hold what it held, so nothing is held or
  // revived on it, and a message the agent took meanwhile is held at the next
  // read that sees the box, where it arrived.
  boxReadable = true
): MobileNativeChatPendingMessage[] {
  /** By `seq`, not by words: two messages of the same words are two echoes. */
  const held = useRef(new Map<number, HeldEcho>())
  /** The box as last read, one slot per entry, each with the raw row that was
   *  last when that entry was first seen: where the message was SENT, which is
   *  where it is drawn (2026-09-23). Per entry, not per words, so two copies of
   *  the same words each keep their own. */
  const previous = useRef<readonly BoxSlot[]>([])
  const previousSent = useRef<readonly string[] | null>(null)
  /** Every queue entry this scope has read, by key, newest last: what a
   *  reading with tool rows glued on is checked against even after the clean
   *  one has been held and retired (readingGluesToolRowsOnto). */
  const listed = useRef<string[]>([])
  const provisional = useRef(new Set<string>())
  const scope = useRef(scopeKey)
  const counter = useRef(0)
  if (scope.current !== scopeKey) {
    scope.current = scopeKey
    held.current = new Map()
    previous.current = []
    provisional.current = new Set()
    previousSent.current = null
    listed.current = []
  }
  // Keyed on collapsed whitespace: the queue box and the scrollback wrap the
  // same message differently, and keying on the raw text showed it twice
  // (2026-09-13).
  const live = (boxReadable ? queued : []).map(promptKey).filter((text) => text.length > 0)
  const own = ownPrompts.map(promptKey)
  const anchorId = rawMessages.at(-1)?.id ?? null
  for (const key of live) {
    if (!listed.current.includes(key)) {
      listed.current = [...listed.current, key].slice(-SIGHTING_CAP)
    }
  }
  // A queued message that did land as its own user turn needs no echo.
  const landedRows = folded.filter((message) => message.role === 'user')
  const landedText = landedRows.map((message) =>
    message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  )
  const landed = landedText.map(promptKey)
  const landedCutKeys = landedText.map(cutKey)
  // Messages this hook knows the words of, whichever copy they came from. A
  // reading that is one of them with a tool's rows glued under it is that
  // message, not a new one.
  const known = (): Set<string> =>
    new Set([...own, ...landed, ...live, ...listed.current, ...[...held.current.values()].map((entry) => entry.key)])
  // The box as read now, each entry matched to the one it was in the last
  // read (matchBoxSlots). An entry that matched none arrived; one of the last
  // read that nothing matched left the box, and the agent has it. A read that
  // could not see the box is none of those: the last read stands.
  const { slots, left, arrived } = boxReadable
    ? matchBoxSlots(previous.current, queued, anchorId)
    : { slots: [...previous.current], left: [], arrived: [] }
  const hold = (slot: BoxSlot): void => {
    // No transcript yet means no row to anchor on, and a null anchor pins
    // the echo to the bottom for good.
    if (slot.key.length === 0 || anchorId === null) {
      return
    }
    // The prompt Claude took, read with the running tool's rows under it
    // (2026-09-27): never a second bubble, whether or not the phone still
    // counts the send as its own.
    if (readingGluesToolRowsOnto(known(), slot.text)) {
      return
    }
    // A new echo, even beside one of the same words: each entry the box let
    // go of is a message the person sent (2026-09-30). Keyed by its words,
    // the second of two "keep going" made no echo, and a longer
    // message that went on from an earlier one at a word boundary was taken
    // for the earlier one with the screen's rows glued on. The box reader
    // stops at the transcript's tool rows now (queueBlockRows), so on this
    // path that rule only cost a message. One message read two ways stays one
    // slot (matchBoxSlots), so it is never held twice.
    counter.current += 1
    held.current.set(counter.current, {
      key: slot.key,
      text: slot.text,
      // The first sighting of each entry is its send: the Claude app draws a
      // mid-turn message there, with the calls that ran while it waited below
      // it, and the user chose that order over the desk terminal's, which
      // draws it where the agent took it (2026-09-23).
      anchorId: slot.sighting ?? anchorId,
      takenAt: anchorId,
      seq: counter.current,
      provisional: provisional.current.has(slot.key)
    })
  }
  // The scrollback is a BACKLOG, not an event: every prompt of the session
  // still painted on screen is in it, including ones whose transcript rows
  // landed long before the page the phone loaded — those can never retire,
  // and adopting the lot on the first reading drew them as one run of user
  // bubbles with no reply between them (2026-09-13, "why is all my messages
  // stacked like these where are my older responses"). So the first reading
  // of a scope is only a baseline; a prompt is held when it APPEARS while the
  // phone is already watching, which is exactly the mid-turn absorb this
  // witness exists for.
  // Nothing is taken from the scrollback any more; see `_sentPrompts`. The
  // agent's queue box below is the only screen witness left.
  for (const slot of left) {
    hold(slot)
  }
  // An entry back in the box with no row written since an echo of its words
  // was held is that message listed again: a read that listed nothing for a
  // moment let it go. The echo goes and the entry keeps its sighting. With a
  // row between, it is a message sent after the agent took the first, and
  // the first stays drawn while it waits (2026-09-30).
  // The reads that list nothing without seeing the box never get here: the
  // link down or not yet read again (the controller hands the chat an empty
  // box then), an entry selected at the desk, a dialog in the composer's
  // place, a block the reader refuses (`boxReadable`, mobile-terminal-queue-read.ts).
  // Taken as an empty box, one of those drew a message still queued beside
  // its own queue entry once a streaming row had landed, and twice once the
  // agent took it (review, 2026-09-30). What still costs that: a read that
  // DOES see an empty box while rows land, then lists the same words again.
  // A genuine second message of those words is that same sequence of reads,
  // so it is drawn twice once the agent takes it. Accepted: the words cannot
  // tell the two apart.
  for (const index of arrived) {
    const slot = slots[index]!
    // Not a reading with a tool's rows glued under a message: the reader ran
    // into the transcript, and the message it names is not back in the box.
    const glued = readingGluesToolRowsOnto(known(), slot.text)
    const echo = [...held.current.values()].findLast(
      (entry) => !glued && entry.takenAt === anchorId && oneMessage(entry.text, slot.text)
    )
    if (echo !== undefined) {
      held.current.delete(echo.seq)
      slots[index] = { ...slot, sighting: echo.anchorId }
    }
  }
  previous.current = slots
  const knownBeforeRetiring = known()
  const rowsSince = rowsFromAnchor(rawMessages, landedRows)
  for (const [seq, entry] of Array.from(held.current.entries())) {
    const key = entry.key
    // Only a row from the one it is drawn after on can be its own: Claude
    // writes no row for a message it takes mid-turn, and a row of its words
    // from an earlier turn retired it the moment the box let go, so a
    // mid-turn "keep going" was drawn nowhere (2026-09-30).
    const since = rowsSince(entry.anchorId)
    const after = <T>(rows: readonly T[]): T[] => rows.filter((_, index) => since[index])
    const textAfter = after(landedText)
    if (
      // Not the box: a copy of these words it still lists is another message,
      // or this one listed again, which the loop above settles.
      own.some((other) => sameMessage(other, key)) ||
      // Held before the message it glues onto was known here.
      readingGluesToolRowsOnto(knownBeforeRetiring, entry.text) ||
      after(landed).some((other) => sameMessage(other, key)) ||
      after(landedCutKeys).some((other) => isCutOf(cutKey(entry.text), other)) ||
      // The witness reads the message off the agent's SCREEN, where it is
      // wrapped and can be shortened; the landed row carries what the author
      // typed. Comparing them exactly left a shortened reading standing beside
      // its own row, so one send showed as two bubbles (2026-09-14).
      // Two safe shapes, and only these. The screen SHORTENED the row it read,
      // so the landed text starts with the reading; or the parser JOINED
      // several stacked rows, so the reading is exactly those rows end to end.
      // A reading that merely extends one landed row is a different message and
      // must be kept (2026-09-14 review).
      textAfter.some((other) => queueRowIsPendingSend(other, entry.text)) ||
      readingIsJoinedLandedRows(textAfter, entry.text)
    ) {
      held.current.delete(seq)
    }
  }
  const echoes = [...held.current.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      id: `queued-${entry.seq}`,
      // No bytes on the phone for a desktop-pasted image: drop its marker.
      // The RAW text, markers and all. Stripping `[Image #N]` here left a
      // queued prompt that carried pictures reading as though nothing had been
      // attached — no photo, since the phone has no bytes for a desktop paste,
      // and no "Image on Desktop" either, because the placeholder is applied
      // where the bubble is DRAWN and needs the marker to still be there
      // (2026-09-15, a prompt with two images). Matching is unaffected: the key
      // functions below normalise the markers away on both sides.
      //
      // Third place this same strip was found — the screen reader and the
      // landed transcript row were the others.
      text: entry.text,
      expectedOccurrence: 0,
      baselineTailMessageId: entry.anchorId,
      baselineResolved: true,
      ...(entry.provisional ? { provisional: true } : {})
    }))
  return useStableEchoes(echoes)
}

/**
 * For the row a held echo is drawn after (the last row when the box first
 * listed it), which landed user rows can be the message's own: that row and
 * the ones after it. A row before it was written before the message was sent.
 *
 * The anchor row itself counts. A box read can be behind the transcript: the
 * chat opened as Claude dequeued a message at a turn's end, its first read
 * still listed the message, and the row Claude dequeued it as was already
 * the last row (mobile-chat-midturn-queue-box.test.ts). What that costs: the
 * same words sent twice with no row written between, the second taken
 * mid-turn, read as one message. The words cannot tell those apart.
 *
 * An anchor the record no longer holds was paged out above the loaded
 * window, so every row held is after it; a landed row the record does not
 * hold counts, as every row did before this rule. The record is indexed on
 * the first call, so a render with nothing held does not walk it.
 */
function rowsFromAnchor(
  rawMessages: readonly NativeChatMessage[],
  rows: readonly NativeChatMessage[]
): (anchorId: string | null) => boolean[] {
  let position: Map<string, number> | null = null
  return (anchorId) => {
    position ??= new Map(rawMessages.map((message, index) => [message.id, index]))
    const at = position
    const anchor = anchorId === null ? undefined : at.get(anchorId)
    return rows.map((row) => anchor === undefined || (at.get(row.id) ?? Infinity) >= anchor)
  }
}

/** A screen reading that stops short of the row that landed — the parser ends
 *  a prompt at a row it cannot tell from the tool fold — still names the same
 *  message (2026-09-13). The cut can only fall on a paragraph break, so the
 *  landed text must continue with one: comparing on plain prefixes retired
 *  "check the build failure" against a later "check the build failure again"
 *  and lost a message that had no transcript row of its own. */
function isCutOf(shorter: string, longer: string): boolean {
  return shorter.length > 0 && longer.startsWith(`${shorter}\n`)
}

/** Like `promptKey`, but paragraph breaks survive, because that is where a
 *  cut reading ends. */
function cutKey(text: string): string {
  return stripImagePromptMarker(asPaintedPrompt(text))
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim()
}

type HeldEcho = {
  key: string
  text: string
  /** Where it is drawn: the row that was last when the box first listed it. */
  anchorId: string | null
  /** The row that was last when the box let it go. */
  takenAt: string
  seq: number
  provisional?: boolean
}

/** One entry of the queue box, and the raw row that was last when the box
 *  first listed it (null while there was no transcript to name one). */
type BoxSlot = { text: string; key: string; sighting: string | null }

/** Whether two readings are one message: the same words, the box's `…` stub
 *  of them, or one that goes on from the other (preferredWitnessReading). */
function oneMessage(a: string, b: string): boolean {
  return sameMessage(promptKey(a), promptKey(b)) || preferredWitnessReading(a, b) !== null
}

/**
 * The box as read now, each entry matched to at most one entry of the last
 * read. A stub that grows into the full text, or a reading that grows by a
 * word between two reads, is the same entry (oneMessage) and keeps the
 * sighting its first reading had; of two readings it keeps the one
 * preferredWitnessReading prefers, as the held echo did before (2026-09-13).
 *
 * The agent takes from the front of its queue and adds at the back, so the
 * entries the last read ended with are matched to the ones this read starts
 * with, the longest such run first: of two copies of the same words, the one
 * that stays is the newer. What that leaves over (the reader running into the
 * transcript above the box, 2026-09-27) is matched entry by entry, the same
 * words first, then the box's `…` stub of them, then any other reading, each
 * to the latest entry of the last read that is one.
 *
 * `left` is what the last read listed and nothing matched, oldest first;
 * `arrived`, the indices of entries nothing in the last read matched.
 */
function matchBoxSlots(
  before: readonly BoxSlot[],
  queued: readonly string[],
  anchorId: string | null
): { slots: BoxSlot[]; left: BoxSlot[]; arrived: number[] } {
  const now = queued.map((text) => ({ text, key: promptKey(text) })).filter((entry) => entry.key.length > 0)
  const slots: (BoxSlot | null)[] = now.map(() => null)
  const open = new Set(before.keys())
  const take = (at: number, index: number): void => {
    open.delete(at)
    const was = before[at]!
    const entry = now[index]!
    const text = was.key !== entry.key && preferredWitnessReading(was.text, entry.text) === 'a' ? was.text : entry.text
    slots[index] = { text, key: promptKey(text), sighting: was.sighting ?? anchorId }
  }
  let from = 0
  while (
    from < before.length &&
    !(before.length - from <= now.length && before.slice(from).every((was, index) => oneMessage(was.text, now[index]!.text)))
  ) {
    from += 1
  }
  for (let at = from; at < before.length; at += 1) {
    take(at, at - from)
  }
  const passes: ((a: BoxSlot, b: { text: string; key: string }) => boolean)[] = [
    (a, b) => a.key === b.key,
    (a, b) => sameMessage(a.key, b.key),
    (a, b) => oneMessage(a.text, b.text)
  ]
  for (const matches of passes) {
    for (const [index, entry] of now.entries()) {
      const match = slots[index] === null ? [...open].findLast((at) => matches(before[at]!, entry)) : undefined
      if (match !== undefined) {
        take(match, index)
      }
    }
  }
  const arrived: number[] = []
  const matched = slots.map((slot, index) => {
    if (slot !== null) {
      return slot
    }
    arrived.push(index)
    return { ...now[index]!, sighting: anchorId }
  })
  return { slots: matched, left: [...open].map((at) => before[at]!), arrived }
}

/** One key for the same message however it reached here: the queue box, the
 *  scrollback and the transcript each wrap it differently, and only the
 *  transcript keeps the `[Image #1]` markers, so both are normalised away. */
function promptKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(text))
}

/** Claude's queue box cuts a long entry short with `…`, so a key read there
 *  is a prefix of the same message read anywhere else (2026-09-13). */
function sameMessage(a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  const stemA = truncatedStem(a)
  const stemB = truncatedStem(b)
  return (stemA != null && b.startsWith(stemA)) || (stemB != null && a.startsWith(stemB))
}

function truncatedStem(key: string): string | null {
  // Only the box's own `…`: a user who ends a sentence with "..." was read as
  // a truncation, and two different messages collapsed into one (2026-09-13).
  const match = /^(.*?)\s*…$/.exec(key)
  const stem = match?.[1] ?? ''
  return stem.length >= 12 ? stem : null
}
