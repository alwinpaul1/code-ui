import { useEffect, useState } from 'react'
import { useStableEchoes } from './use-stable-echoes'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { placeAfterStandIn, replaceFoundByLateTwin, STAND_IN_WAIT, STAND_IN_TWIN_WAIT_MS } from './desk-prompt-stand-in-place'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import { cutWholeCharacters } from '../text/whole-character-cut'

/** Which prompts the transcript already shows lives in desk-prompt-landed.ts;
 *  the chat and the tests still reach it here. */
export { landedKey, withoutLandedDesktopPrompts } from './desk-prompt-landed'


/**
 * Prompts the user typed on the DESKTOP, drawn on the phone as their own
 * bubbles.
 *
 * Why they need this path at all: Claude Code writes a prompt submitted while
 * a turn is running as an `attachment`/`queued_command` record, and Orca's
 * transcript reader drops those, so the phone's transcript never carries them
 * (2026-09-13). The text arrives on the HUD beacon instead, from the agent's
 * own UserPromptSubmit hook.
 *
 * Each prompt is anchored to whatever the last transcript row was when it
 * first arrived, and stays there — the same treatment a phone-side echo gets
 * when its own transcript row never lands. The anchor is remembered per
 * prompt, so later turns cannot drag it down the conversation.
 */

/**
 * Where each desktop prompt belongs, kept OUTSIDE the component.
 *
 * This was a `useRef`, so it died with the mount. The chat remounts on a tab
 * switch and FlashList recycles rows, and on the next mount every anchor was
 * derived again from nothing: while the beaconed row was still inside the live
 * window that redraw was harmless, but once it had paged out the fallback took
 * the CURRENT tail, and a prompt typed ten turns ago jumped to the bottom of
 * the conversation under replies it came before. Several follow-ups all landed
 * on the same tail, stacked together — which is what was reported on
 * 2026-09-15 ("the follow up prompts send from the desktop werent correctly
 * placed").
 *
 * Second time this shape has bitten: the sticky HUD hold was a `useRef` for the
 * same reason, and the rule for a repeat is to sweep rather than patch.
 *
 * Eviction renews on READ, not only on write. Plain insertion order drops
 * whatever has been held longest, which here is the oldest UNRETIRED prompt —
 * precisely the one whose anchor cannot be rediscovered.
 */
const anchorByNonce = new Map<string, string | null>()
const DESKTOP_PROMPT_ANCHOR_CAP = 256

function rawIndex(rawMessages: readonly NativeChatMessage[], id: string): number {
  return rawMessages.findIndex((message) => message.id === id)
}

/**
 * How many readings a prompt may WAIT for the row the beacon named.
 *
 * A beacon usually arrives before the transcript rows of the turn it was typed
 * into. Taking the arrival-time tail in the meantime looked harmless and was
 * not: the decision is permanent, so every prompt from one turn took the same
 * tail and they drew as one stack with the replies pushed below them (device
 * screenshot, 2026-09-15 — "the entire user prompts stack on together").
 *
 * So a beaconed prompt waits. The bound exists because the row may genuinely
 * never come — an older window, a compacted transcript, a row the hook named
 * wrongly — and a message with no position must still be shown rather than
 * hidden for good. It settles where it was first seen (`provisionalByNonce`).
 * Until 2026-09-29 it settled on the tail of its last reading instead: with the
 * phone asleep through a turn that was the last reply, and a message typed at
 * 05:36 settled under the 05:46 answer to it.
 */
const ANCHOR_WAIT_READINGS = 30
const waitsByNonce = new Map<string, number>()
/** The tail when a waiting prompt was FIRST seen, held still: at its first
 *  reading that held a row. Null while it has been seen only over a chat with
 *  no row yet: that still marks it as seen here (`foundWithoutItsRow`), and
 *  the first reading with a row replaces it.
 *
 *  Read fresh each render instead, the provisional position followed the tail
 *  down as the turn wrote rows, and the prompt ended up below the reply it had
 *  caused — two of them stacking on the same last row (device screenshot,
 *  2026-09-15). The tail at first sighting is roughly where a mid-turn prompt
 *  belongs, which is what the code did before the waiting was added; the wait
 *  only ever UPGRADES it to the beaconed row, and when the wait runs out this
 *  is where it settles. Until 2026-09-29 a null taken before a row was held
 *  stayed, and a null anchor over held rows draws the bubble at the top of
 *  the chat. */
const provisionalByNonce = new Map<string, string | null>()
/** Prompts whose anchor came from their TIME, still open to a later row.
 *
 *  A timed anchor is the last held row written before the prompt, and the
 *  phone's rows lag the desk: at first sight the row written 1.2 s before the
 *  send had not loaded, so nine calls read as eight (device, 2026-09-20). For
 *  a while after the prompt a later-loading row that still predates it moves
 *  the anchor down; nothing written after the prompt ever qualifies, so a
 *  later turn cannot drag it. */
const timedByNonce = new Map<string, number>()
const TIMED_ANCHOR_OPEN_MS = 10 * 60_000
/** How long before a send a row must be stamped to count as written before it.
 *
 *  Claude Code writes a thinking block or a tool call once it is complete, and
 *  its stamp can lead the write by a moment: a thinking block and a call stamped
 *  a fifth of a second before a send from the Claude app were written after the
 *  enqueue, and the Claude app drew them below the message (session 967668df,
 *  2026-09-23, "See this message to mahdi…"). A reply the reader saw before
 *  sending is older than that ("All 9 tests pass…" was 1.6 s). The phone's own
 *  sends allow the same second (mid-turn-written-before.ts). */
const WRITTEN_BEFORE_SLACK_MS = 1000

function rememberedAnchor(nonce: string): string | null | undefined {
  if (!anchorByNonce.has(nonce)) {
    return undefined
  }
  const anchor = anchorByNonce.get(nonce) ?? null
  anchorByNonce.delete(nonce)
  anchorByNonce.set(nonce, anchor)
  return anchor
}

/** Follow a timed copy's later rows, keeping at most the cap: the follow
 *  stays open while earlier rows are unloaded, which in a long session is
 *  always (review of fe1c055a). */
function followTimed(nonce: string, at: number): void {
  timedByNonce.delete(nonce)
  if (timedByNonce.size >= DESKTOP_PROMPT_ANCHOR_CAP) {
    const oldest = timedByNonce.keys().next()
    if (!oldest.done) {
      timedByNonce.delete(oldest.value)
    }
  }
  timedByNonce.set(nonce, at)
}

function rememberAnchor(nonce: string, anchor: string | null): void {
  provisionalByNonce.delete(nonce)
  timedByNonce.delete(nonce)
  anchorByNonce.delete(nonce)
  if (anchorByNonce.size >= DESKTOP_PROMPT_ANCHOR_CAP) {
    const oldest = anchorByNonce.keys().next()
    if (!oldest.done) {
      anchorByNonce.delete(oldest.value)
    }
  }
  anchorByNonce.set(nonce, anchor)
}

export function useDesktopPromptEchoes(
  prompts: readonly DesktopPrompt[],
  folded: readonly NativeChatMessage[],
  // The RAW tail, for the same reason the absorbed-queue echoes use it: a
  // folded run is one row, so folded anchors would stack every echo together.
  rawMessages: readonly NativeChatMessage[] = folded,
  /** Whether rows older than the loaded page exist and are not loaded. A
   *  prompt older than every held row is then a row above the page, not a
   *  bubble to place: it shows when the page that holds it loads, and the
   *  hook copy retires against it (device, 2026-09-20: a 2,858-character
   *  prompt drawn as its 200-character hook cut, under the tool fold). */
  hasEarlier = false,
  /** Whether the chat's read of this session has settled. Before it does,
   *  `hasEarlier` is false and no row is held, which says nothing about a
   *  row being missing (sixth review of this rule, 2026-09-27). */
  readSettled = true,
  /** Whether the tab was launched with the prompt hook (`hk=1`): every prompt
   *  it takes while the chat is open reaches the phone as a hook copy too. */
  promptHook = false
): MobileNativeChatPendingMessage[] {
  const echoes: MobileNativeChatPendingMessage[] = []
  const refused: DesktopPrompt[] = []
  const drawnWhereFirstSeen: DesktopPrompt[] = []
  const rowBefore = (at: number | undefined) => lastRowBefore(rawMessages, at)
  // The earliest moment a status copy waiting for its hook twin may be drawn
  // (waitsForHookTwin), and a reading to come at it: readings happen only when
  // something re-renders, and a quiet pane would leave the copy hidden.
  let twinDeadline: number | undefined
  const [, askForReading] = useState(0)
  for (const prompt of prompts) {
    // A status copy held back for want of a time pairs with the phone's sends
    // and is never drawn (agent-status-prompts.ts, 2026-09-26).
    if (prompt.heldBack === true) {
      continue
    }
    const deadline = waitsForHookTwin(prompt, promptHook)
    if (deadline !== undefined) {
      twinDeadline = twinDeadline === undefined ? deadline : Math.min(twinDeadline, deadline)
      continue
    }
    if (foundWithoutItsRow(prompt, rawMessages)) {
      if (!hasEarlier && readSettled) {
        refused.push(prompt)
      }
      continue
    }
    // By the desk's clock: the status's time, or the prompt hook's own (`ts=`).
    const when = deskTimeOf(prompt)
    // A copy whose named row is not held (the status names none), timed before
    // every held row, with earlier rows not loaded, was typed on a page above:
    // it is drawn when that page loads, not under this one's last reply. After
    // a sleep every copy of a turn was first seen at once on the turn's tail
    // page, and each settled under its last reply, all in a row (reported
    // 2026-09-29, "All 3 prompts stacked together with no responses in between
    // them").
    if (
      hasEarlier &&
      rememberedAnchor(prompt.nonce) === undefined &&
      (prompt.anchorId === undefined || !rawMessages.some((message) => message.id === prompt.anchorId)) &&
      lastRowBefore(rawMessages, when) === null
    ) {
      continue
    }
    // Where it was SENT, never where the agent took it: the Claude app draws a
    // mid-turn message at its send, with the calls that ran while it waited
    // below it, and the user chose that order (2026-09-23). Between 2026-09-20
    // and then the queue box's release moved it to the take, as the desk's
    // terminal draws it.
    if (timedByNonce.has(prompt.nonce)) {
      const at = timedByNonce.get(prompt.nonce)!
      const current = rememberedAnchor(prompt.nonce) ?? null
      const later = lastRowBefore(rawMessages, at - WRITTEN_BEFORE_SLACK_MS)
      // Closed by the transcript's own clock, not the phone's: once a held
      // row was written this long after the prompt, the rows before it are
      // all in and there is nothing left to load. Not while earlier rows are
      // unloaded: a tail page read after a sleep holds rows ten minutes after
      // the prompt and none of the rows before it (review of 15fcfbea).
      const closed =
        !hasEarlier &&
        rawMessages.some((message) => message.timestamp !== null && message.timestamp - at >= TIMED_ANCHOR_OPEN_MS)
      if (
        typeof later === 'string' &&
        later !== current &&
        rawIndex(rawMessages, later) > rawIndex(rawMessages, current ?? '')
      ) {
        rememberAnchor(prompt.nonce, later)
        if (!closed) {
          followTimed(prompt.nonce, at)
        }
      } else if (closed) {
        timedByNonce.delete(prompt.nonce)
      }
    }
    // A beacon restored before the transcript loads would pin the echo to
    // the bottom for good; wait for a row to anchor on (2026-09-13).
    const newest = rawMessages.at(-1)
    let waitingForItsCopy = false
    let unsettledPlace: string | null | undefined
    const late = prompt.foundAt === undefined ? undefined : replaceFoundByLateTwin(prompt, rawMessages, rowBefore)
    if (late !== undefined) {
      rememberAnchor(prompt.nonce, late)
    }
    if (rememberedAnchor(prompt.nonce) === undefined && newest !== undefined) {
      // Where this chat first saw it: the tail of its first reading with a row.
      const firstSeenAfter = provisionalByNonce.get(prompt.nonce) ?? newest.id
      provisionalByNonce.set(prompt.nonce, firstSeenAfter)
      // The hook beacons the row that was last at SUBMIT time (`at=`). When
      // the phone holds that row, anchor there — however late the beacon
      // arrived, the message lands where the Claude app shows the record.
      // Only without it (an older hook, or the row paged out of the window)
      // does the arrival-time tail stand in (2026-09-14).
      const beaconed = prompt.anchorId
      // A copy found on a first reading is timed by the start of its run, a
      // bound below it; its hook copy's row is where it was typed (the review
      // of 5d17a9d0, B4: after a comeback, a message typed mid-run drew at
      // its run's start, above rows written before it).
      const twinRow = prompt.atStateStart === true ? prompt.hookTwin?.anchorId : undefined
      const anchorRow =
        beaconed !== undefined
          ? rawMessages.find((message) => message.id === beaconed)
          : twinRow !== undefined
            ? rawMessages.find((message) => message.id === twinRow)
            : undefined
      // The transcript names the row it was written after, and on the device
      // that row was a tool call or result the phone did not hold. (Orca
      // 1.4.216's decoder does make a row of each, keyed by the record uuid,
      // read 2026-09-29, so on that build it may be held; this path is for
      // when it is not.) The record's own time is enough: the last row
      // written before it is where it belongs. Without this the wait ran out and the echo
      // fell to the arrival tail, three turns under the reply that answered
      // it (device, 2026-09-19).
      const timedRow = anchorRow === undefined ? lastRowBefore(rawMessages, when) : undefined
      const afterStandIn = prompt.foundAt === undefined ? undefined : placeAfterStandIn(prompt, rawMessages, promptHook, rowBefore)
      if (afterStandIn === STAND_IN_WAIT) {
        // Drawn where it was first seen meanwhile, not settled, and not
        // remembered there either (`provisional` below).
        waitingForItsCopy = true
      } else if (afterStandIn !== undefined) {
        waitsByNonce.delete(prompt.nonce)
        rememberAnchor(prompt.nonce, afterStandIn)
      } else if (anchorRow) {
        waitsByNonce.delete(prompt.nonce)
        rememberAnchor(prompt.nonce, anchorRow.id)
        // The named row is the transcript's last RECORD at submit, and a reply
        // still streaming is not a record yet: the hook named the tool result
        // above "All 9 tests pass…", sent 1.6 s after it, and the message drew
        // above the reply (2026-09-23). Still follow any row written before the
        // send once it loads — the same clock, the desktop's, on both sides.
        // The hook's copy names its last TEXT row, so this also moves it below
        // the calls written after those words and before the send, where the
        // Claude app draws it: those stamped a second before the start of its
        // second, for a hook's whole-second `typedAt`.
        if (when !== undefined) {
          followTimed(prompt.nonce, when)
        }
      } else if (timedRow !== undefined && !readSettled) {
        // The rows of a read that has not settled can be the transcript kept
        // from before a sleep: a place among them is drawn for now and not
        // kept, or the fresh page closed the follow and every copy of the turn
        // stayed after the kept tail, in a row (review of 15fcfbea).
        unsettledPlace = timedRow
      } else if (timedRow !== undefined) {
        waitsByNonce.delete(prompt.nonce)
        rememberAnchor(prompt.nonce, timedRow)
        if (when !== undefined) {
          followTimed(prompt.nonce, when)
        }
      } else if (beaconed === undefined) {
        // An older hook names no row; the arrival tail is all there is.
        rememberAnchor(prompt.nonce, newest.id)
      } else {
        const waited = (waitsByNonce.get(prompt.nonce) ?? 0) + 1
        waitsByNonce.set(prompt.nonce, waited)
        if (waited > ANCHOR_WAIT_READINGS) {
          waitsByNonce.delete(prompt.nonce)
          // Where it has been drawn all along, not the tail now. Several such
          // copies read at once stay in a row under one reply, which is what
          // the stack of 2026-09-29 looks like, so the log says why, once.
          rememberAnchor(prompt.nonce, firstSeenAfter)
          drawnWhereFirstSeen.push(prompt)
        }
      }
    }
    // While a prompt is still waiting for its row it has no REMEMBERED anchor,
    // and an echo with no position is not drawn at all. That was meant to last a
    // render or two; it does not, because the wait counts READINGS and readings
    // only happen while something re-renders — so once the turn went quiet the
    // message stayed invisible with no way back (reported 2026-09-15, straight
    // after the waiting landed). It shows at the tail meanwhile, provisionally,
    // and moves up the moment its real row arrives. Visible in roughly the right
    // place beats correct and invisible. With no row held yet there is no
    // first place, and a null anchor over an empty chat draws it at the end;
    // the null still records that this chat drew it.
    const settled = rememberedAnchor(prompt.nonce)
    if (settled === undefined && !provisionalByNonce.has(prompt.nonce)) {
      provisionalByNonce.set(prompt.nonce, null)
    }
    const placement =
      settled !== undefined ? settled : unsettledPlace !== undefined ? unsettledPlace : (provisionalByNonce.get(prompt.nonce) ?? null)
    echoes.push({
      id: deskEchoId(prompt.nonce),
      // The RAW text, marker and all. It is what this echo is matched against
      // when its transcript row lands — and `normalizeNativeChatUserText`
      // deletes `[Image #N]` from both sides, so the keys agree. Rewriting the
      // marker here instead made them diverge, and the echo could never retire:
      // the message drew twice, for good (2026-09-15). The placeholder the
      // reader sees is applied where the bubble is BUILT, not here.
      text: prompt.text,
      expectedOccurrence: 0,
      baselineTailMessageId: placement,
      baselineResolved: true,
      // Kept by the witness memory from its first drawing, waiting or not, so
      // a relaunch still draws it and a phone send of the same words cannot
      // take it (review of fe1c055a). While this run's chat is placing it, the
      // stored copy gives way to it (`placedHere`), so it can still move.
      ...(waitingForItsCopy ? { provisional: true } : {})
    })
  }
  // With every row loaded, a copy still held names a row the transcript does
  // not have (a record Orca draws nothing for, such as an `isMeta` row): it
  // will not be drawn, and the log says so once (2026-09-27).
  const refusals = JSON.stringify([
    ...refused.map((prompt) => [
      `not-drawn:${prompt.nonce}`,
      `[desk-prompt] not drawn: the beacon's copy of "${logQuote(prompt.text)}" was found long after it arrived, and the row it was typed after (${prompt.anchorId}) is not in the transcript`
    ]),
    ...drawnWhereFirstSeen.map((prompt) => [
      `first-seen:${prompt.nonce}`,
      `[desk-prompt] drawn where first seen: the beacon's copy of "${logQuote(prompt.text)}" names a row the chat did not hold through its wait (${prompt.anchorId}), and ${deskTimeOf(prompt) === undefined ? 'its hook sent no time (a tab launched before the hook said when it ran)' : 'no row the chat holds carries a time'}, so nothing placed it closer`
    ])
  ])
  useEffect(() => {
    if (twinDeadline === undefined) {
      return undefined
    }
    const timer = setTimeout(() => askForReading((reading) => reading + 1), Math.max(0, twinDeadline - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [twinDeadline])
  useEffect(() => {
    for (const [key, line] of JSON.parse(refusals) as [string, string][]) {
      if (!loggedRefusals.has(key)) {
        loggedRefusals.add(key)
        console.warn(line)
      }
    }
  }, [refusals])
  return useStableEchoes(echoes)
}

/**
 * When a status copy that waits for its hook twin may be drawn, or undefined
 * when it does not wait.
 *
 * On a tab with the prompt hook a tick that fires mid-turn reaches the phone
 * twice, and the hook's copy alone carries the loop's mark (`sc=1`); the
 * status copy came first and drew as a user bubble until the mark arrived, a
 * flash of the loop's words every tick (2026-10-01). So a status copy the chat
 * watched arrive, with no twin yet, waits as long as a copy found after Orca's
 * stand-in does (STAND_IN_TWIN_WAIT_MS), and is drawn after that when the twin
 * never comes (a frame lost on the pty or the relay). Not a beacon copy, which
 * carries its own mark; not a tab without the hook, which has no twin to wait
 * for; not a copy found on a first reading, which is old, or one read after
 * Orca's stand-in, which waits in its own way (placeAfterStandIn).
 */
function waitsForHookTwin(prompt: DesktopPrompt, promptHook: boolean): number | undefined {
  if (
    !promptHook ||
    !prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) ||
    prompt.hookTwin !== undefined ||
    prompt.atStateStart === true ||
    prompt.foundAt !== undefined ||
    typeof prompt.seenAt !== 'number'
  ) {
    return undefined
  }
  const deadline = prompt.seenAt + STAND_IN_TWIN_WAIT_MS
  return Date.now() < deadline ? deadline : undefined
}

/** The lines already logged, by kind and nonce, so each says so once. */
const loggedRefusals = new Set<string>()

/** A message's first 32 code units for a log line, and `…` when there is
 *  more: never the first half of an emoji, which `slice` left there as a
 *  lone surrogate (review of 2026-09-30). */
function logQuote(text: string): string {
  return `${cutWholeCharacters(text, 32)}${text.length > 32 ? '…' : ''}`
}

/**
 * Whether a beacon copy is one the chat found long after it arrived, with the
 * row it was typed after not held and no time to place it by (a hook from
 * before `ts=`). The beacon names that row and nothing else, so while the row
 * is on a page not loaded there is nowhere to draw it:
 * waiting for it drew the copy at the tail, and after the wait it stayed there
 * for good (2026-09-27, the beacon's side of session 76ba8f2f's 13:20 prompt;
 * a relaunch restores 40 such copies). It is drawn once the row loads. A row
 * Orca draws nothing for (an `isMeta` record, say) never loads, and such a
 * copy is never drawn; with every row loaded the chat logs that once. (This
 * named a tool call as such a row. Orca 1.4.216's decoder does make a row of
 * one, keyed by the record uuid, read 2026-09-29.)
 *
 * Only a copy no chat has placed or waited on this run, and that arrived more
 * than TIMED_ANCHOR_OPEN_MS before this reading. One that arrived just before
 * the chat opened (the tab showed its terminal) is the live case the wait is
 * for, and still waits at the tail.
 */
function foundWithoutItsRow(prompt: DesktopPrompt, rawMessages: readonly NativeChatMessage[]): boolean {
  return (
    prompt.anchorId !== undefined &&
    deskTimeOf(prompt) === undefined &&
    arrivedLongAgo(prompt.seenAt) &&
    !anchorByNonce.has(prompt.nonce) &&
    !provisionalByNonce.has(prompt.nonce) &&
    !waitsByNonce.has(prompt.nonce) &&
    !rawMessages.some((message) => message.id === prompt.anchorId)
  )
}

/** Whether a beacon copy arrived more than TIMED_ANCHOR_OPEN_MS before now:
 *  found then, not seen arrive, and the tail is no place for it. */
export function arrivedLongAgo(seenAt: number | undefined): boolean {
  return typeof seenAt === 'number' && Date.now() - seenAt > TIMED_ANCHOR_OPEN_MS
}

/** When a copy was typed, by the desk clock the rows are stamped by: the
 *  status's time (`at`), else the prompt hook's own (`typedAt`, `ts=`). The
 *  hook's is a whole second, the start of the second it ran. */
function deskTimeOf(prompt: DesktopPrompt): number | undefined {
  return prompt.at ?? typedAtOf(prompt)
}

/** The hook's `typedAt` when it is a time the beacon writes: whole seconds, in
 *  ms, from nine to eleven digits of them. The warm start restores a stored
 *  copy's fields unchecked, and seconds or 0 there moved a remembered message
 *  to the top of the chat (review of 15fcfbea). */
export function typedAtOf(prompt: DesktopPrompt): number | undefined {
  const typed = prompt.typedAt
  return typeof typed === 'number' && Number.isInteger(typed) && typed % 1000 === 0 && typed >= 1e11 && typed < 1e14 ? typed : undefined
}

/** Whether this run's chat is placing a desk copy itself: it drew it and
 *  waits on its row, or placed it. Its stored witness gives way to it then,
 *  so a row that loads later still moves it; stored at once and drawn by the
 *  witness, its waiting place was final (2026-09-29). After a relaunch these
 *  maps are empty, pairing hides the copy behind its witness before this hook
 *  sees it, and the witness draws it where it was. */
export function placedHere(nonce: string): boolean {
  return anchorByNonce.has(nonce) || provisionalByNonce.has(nonce) || waitsByNonce.has(nonce)
}

/** The bubble id of a hook prompt's echo. */
export function deskEchoId(nonce: string): string {
  return `desk-${nonce}`
}

/** The id of the last row written at or before `at`, null when every held
 *  row is later (the prompt led the conversation), undefined when there is no
 *  time to go by or no row carries one. */
export function lastRowBefore(
  rawMessages: readonly NativeChatMessage[],
  at: number | undefined
): string | null | undefined {
  if (at === undefined) {
    return undefined
  }
  let found: string | null | undefined
  let any = false
  for (const message of rawMessages) {
    if (message.timestamp === null) {
      continue
    }
    any = true
    if (message.timestamp <= at) {
      found = message.id
    }
  }
  if (!any) {
    return undefined
  }
  return found ?? null
}
