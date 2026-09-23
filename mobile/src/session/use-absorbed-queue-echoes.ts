import { useRef } from 'react'
import {
  queueRowIsPendingSend,
  readingIsJoinedLandedRows
} from './mobile-terminal-queued-messages'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { useStableEchoes } from './use-stable-echoes'
import { preferredWitnessReading } from './mobile-native-chat-witness-dedupe'
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
/** Queue entries whose first sighting is remembered at once; see `appeared`. */
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
   * It existed because a prompt queued mid-turn was said to land only as an
   * `attachment`/`queued_command` record the phone cannot read (verified
   * 2026-09-13). That is no longer true: on Claude Code 2.1.272 it lands as an
   * ordinary `user` row with `promptSource: "queued"`, which the phone already
   * reads — 18 of them in the session this was reported from, every one a real
   * row. So the witness was inventing a second copy of a message the phone
   * already had. See mobile-scrollback-prompt-witness.test.ts for the evidence.
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
  ownPrompts: readonly string[] = []
): MobileNativeChatPendingMessage[] {
  const held = useRef(new Map<string, HeldEcho>())
  const previous = useRef<readonly string[]>([])
  const previousSent = useRef<readonly string[] | null>(null)
  /** The raw row that was last when each queue entry was first seen, by key:
   *  where the message was SENT, which is where it is drawn (2026-09-23). */
  const appeared = useRef(new Map<string, string>())
  const provisional = useRef(new Set<string>())
  const scope = useRef(scopeKey)
  const counter = useRef(0)
  if (scope.current !== scopeKey) {
    scope.current = scopeKey
    held.current = new Map()
    previous.current = []
    provisional.current = new Set()
    previousSent.current = null
    appeared.current = new Map()
  }
  // Keyed on collapsed whitespace: the queue box and the scrollback wrap the
  // same message differently, and keying on the raw text showed it twice
  // (2026-09-13).
  const live = queued.map(promptKey).filter((text) => text.length > 0)
  const own = ownPrompts.map(promptKey)
  const anchorId = rawMessages.at(-1)?.id ?? null
  // The first sighting of each entry is its send: the Claude app draws a
  // mid-turn message there, with the calls that ran while it waited below it,
  // and the user chose that order over the desk terminal's, which draws it
  // where the agent took it (2026-09-23). A stub that grows into the full text
  // keeps the sighting its first reading had.
  const sightingFor = (key: string): string | undefined => {
    for (const [seen, sighting] of appeared.current) {
      if (sameMessage(seen, key) || preferredWitnessReading(seen, key) !== null) {
        return sighting
      }
    }
    return undefined
  }
  if (anchorId !== null) {
    for (const key of live) {
      if (sightingFor(key) === undefined) {
        appeared.current.set(key, anchorId)
        // Bounded: a sighting is dropped once its message is held, and an entry
        // that never leaves the box must not grow this for the whole session.
        if (appeared.current.size > SIGHTING_CAP) {
          const oldest = appeared.current.keys().next()
          if (!oldest.done) {
            appeared.current.delete(oldest.value)
          }
        }
      }
    }
  }
  const hold = (text: string, skipOwn: boolean, mayCreate = true): void => {
    const key = promptKey(text)
    // No transcript yet means no row to anchor on, and a null anchor pins
    // the echo to the bottom for good; it is picked up on a later render.
    if (key.length === 0 || anchorId === null || live.some((k) => sameMessage(k, key))) {
      return
    }
    // A reading that only glues the screen's rows onto one of the phone's
    // own sends is that send, not a new message (2026-09-13: "phone test
    // message from adb Reading 1 file…").
    if (skipOwn && own.some((k) => sameMessage(k, key) || preferredWitnessReading(k, key) === 'a')) {
      return
    }
    const existing = [...held.current.entries()].find(
      ([k]) => sameMessage(k, key) || preferredWitnessReading(k, key) !== null
    )
    if (existing) {
      // One message, two readings: the queue box's `…` stub grows into the
      // full text, and a reading that only glues the screen's own rows onto
      // a complete one loses to it (see `preferredWitnessReading`).
      if (preferredWitnessReading(existing[0], key) === 'b') {
        held.current.delete(existing[0])
        held.current.set(key, { ...existing[1], text })
      }
      return
    }
    if (!mayCreate) {
      return
    }
    counter.current += 1
    held.current.set(key, {
      text,
      anchorId: sightingFor(key) ?? anchorId,
      seq: counter.current,
      provisional: provisional.current.has(key)
    })
    for (const seen of Array.from(appeared.current.keys())) {
      if (sameMessage(seen, key) || preferredWitnessReading(seen, key) !== null) {
        appeared.current.delete(seen)
      }
    }
  }
  // The scrollback is a BACKLOG, not an event: every prompt of the session
  // still painted on screen is in it, including ones whose transcript rows
  // landed long before the page the phone loaded — those can never retire,
  // and adopting the lot on the first reading drew them as one run of user
  // bubbles with no reply between them (2026-09-13, "why is all my messages
  // stacked like these where are my older responses"). So the first reading
  // of a scope is only a baseline; a prompt is held when it APPEARS while the
  // phone is already watching, which is exactly the mid-turn absorb this
  // witness exists for. An entry already held still grows from a fuller
  // reading, so a truncated queue entry is not stuck short.
  // Nothing is taken from the scrollback any more; see `_sentPrompts`. The
  // agent's queue box below is the only screen witness left.
  for (const text of previous.current) {
    hold(text, false)
  }
  previous.current = queued
  // A queued message that did land as its own user turn needs no echo.
  const landedText = folded
    .filter((message) => message.role === 'user')
    .map((message) =>
      message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
    )
  const landed = landedText.map(promptKey)
  const landedCutKeys = landedText.map(cutKey)
  for (const key of Array.from(held.current.keys())) {
    const entry = held.current.get(key)
    if (
      [...live, ...own].some((other) => sameMessage(other, key)) ||
      landed.some((other) => sameMessage(other, key)) ||
      (entry != null && landedCutKeys.some((other) => isCutOf(cutKey(entry.text), other))) ||
      // The witness reads the message off the agent's SCREEN, where it is
      // wrapped and can be shortened; the landed row carries what the author
      // typed. Comparing them exactly left a shortened reading standing beside
      // its own row, so one send showed as two bubbles (2026-09-14).
      // Two safe shapes, and only these. The screen SHORTENED the row it read,
      // so the landed text starts with the reading; or the parser JOINED
      // several stacked rows, so the reading is exactly those rows end to end.
      // A reading that merely extends one landed row is a different message and
      // must be kept (2026-09-14 review).
      (entry != null && landedText.some((other) => queueRowIsPendingSend(other, entry.text))) ||
      (entry != null && readingIsJoinedLandedRows(landedText, entry.text))
    ) {
      held.current.delete(key)
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

type HeldEcho = { text: string; anchorId: string | null; seq: number; provisional?: boolean }


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
