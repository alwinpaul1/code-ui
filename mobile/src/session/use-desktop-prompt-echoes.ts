import { useEffect } from 'react'
import { useStableEchoes } from './use-stable-echoes'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { withShortSkillToken } from './mobile-native-chat-command-turns'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'
import { photosOnlyPrompt } from './mobile-native-chat-image-transcript-markers'
import { teammateTask } from './mobile-native-chat-peer-messages'
import { joinedLineBetween, ownedByLaterSubmission, placeOfCopy, rowOwners, withoutLateHookTwins } from './desk-prompt-row-owners'
import { placeAfterStandIn, replaceFoundByLateTwin, STAND_IN_WAIT } from './desk-prompt-stand-in-place'


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
  const rowBefore = (at: number | undefined) => lastRowBefore(rawMessages, at)
  for (const prompt of prompts) {
    // A status copy held back for want of a time pairs with the phone's sends
    // and is never drawn (agent-status-prompts.ts, 2026-09-26).
    if (prompt.heldBack === true) {
      continue
    }
    if (foundWithoutItsRow(prompt, rawMessages)) {
      if (!hasEarlier && readSettled) {
        refused.push(prompt)
      }
      continue
    }
    if (
      hasEarlier &&
      rememberedAnchor(prompt.nonce) === undefined &&
      prompt.anchorId === undefined &&
      lastRowBefore(rawMessages, prompt.at) === null
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
      // all in and there is nothing left to load.
      const closed = rawMessages.some(
        (message) => message.timestamp !== null && message.timestamp - at >= TIMED_ANCHOR_OPEN_MS
      )
      if (
        typeof later === 'string' &&
        later !== current &&
        rawIndex(rawMessages, later) > rawIndex(rawMessages, current ?? '')
      ) {
        rememberAnchor(prompt.nonce, later)
        if (!closed) {
          timedByNonce.set(prompt.nonce, at)
        }
      } else if (closed) {
        timedByNonce.delete(prompt.nonce)
      }
    }
    // A beacon restored before the transcript loads would pin the echo to
    // the bottom for good; wait for a row to anchor on (2026-09-13).
    const newest = rawMessages.at(-1)
    let waitingForItsCopy = false
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
      const timedRow = anchorRow === undefined ? lastRowBefore(rawMessages, prompt.at) : undefined
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
        if (prompt.at !== undefined) {
          timedByNonce.set(prompt.nonce, prompt.at)
        }
      } else if (timedRow !== undefined) {
        waitsByNonce.delete(prompt.nonce)
        rememberAnchor(prompt.nonce, timedRow)
        if (prompt.at !== undefined) {
          timedByNonce.set(prompt.nonce, prompt.at)
        }
      } else if (beaconed === undefined) {
        // An older hook names no row; the arrival tail is all there is.
        rememberAnchor(prompt.nonce, newest.id)
      } else {
        const waited = (waitsByNonce.get(prompt.nonce) ?? 0) + 1
        waitsByNonce.set(prompt.nonce, waited)
        if (waited > ANCHOR_WAIT_READINGS) {
          waitsByNonce.delete(prompt.nonce)
          // Where it has been drawn all along, not the tail now.
          rememberAnchor(prompt.nonce, firstSeenAfter)
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
      settled === undefined ? (provisionalByNonce.get(prompt.nonce) ?? null) : settled
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
      ...(waitingForItsCopy ? { provisional: true } : {})
    })
  }
  // With every row loaded, a copy still held names a row the transcript does
  // not have (a record Orca draws nothing for, such as an `isMeta` row): it
  // will not be drawn, and the log says so once (2026-09-27).
  const refusals = JSON.stringify(
    refused.map((prompt) => [
      prompt.nonce,
      `[desk-prompt] not drawn: the beacon's copy of "${prompt.text.slice(0, 32)}${prompt.text.length > 32 ? '…' : ''}" was found long after it arrived, and the row it was typed after (${prompt.anchorId}) is not in the transcript`
    ])
  )
  useEffect(() => {
    for (const [nonce, line] of JSON.parse(refusals) as [string, string][]) {
      if (!loggedRefusals.has(nonce)) {
        loggedRefusals.add(nonce)
        console.warn(line)
      }
    }
  }, [refusals])
  return useStableEchoes(echoes)
}

/** The refusals already logged, so each says so once. */
const loggedRefusals = new Set<string>()

/**
 * Whether a beacon copy is one the chat found long after it arrived, with the
 * row it was typed after not held. The beacon names that row and gives no
 * time, so while the row is on a page not loaded there is nowhere to draw it:
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
    prompt.at === undefined &&
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

/** Drop prompts the transcript already shows: a prompt submitted while the
 *  agent was idle IS written as a user turn, and would otherwise appear
 *  twice. Compared on the same key every other witness uses, so a transcript
 *  row carrying `[Image #1]` markers or different wrapping still counts. */
export function withoutLandedDesktopPrompts(
  prompts: readonly DesktopPrompt[],
  folded: readonly NativeChatMessage[],
  alsoShown: readonly string[] = [],
  /** The transcript as read, `[Image #N]` markers and all: a photo sent with
   *  no words has no key, and lands as the row of exactly its markers
   *  (Claude Code numbers photos through a session). */
  raw: readonly NativeChatMessage[] = []
): DesktopPrompt[] {
  prompts = withoutLateHookTwins(prompts, raw)
  // The rows as read, and what the agent's queue box lists (fourth review: a
  // desk photo of no words drew in the box and as a bubble above it).
  const landedMarkers = new Set(
    [
      ...raw.map((message) =>
        message.role === 'user' ? message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(' ') : ''
      ),
      ...alsoShown
    ].flatMap((text) => (photosOnlyPrompt(text) > 0 ? [markersOf(text)] : []))
  )
  const seen = [
    ...folded
      .filter((message) => message.role === 'user')
      .map((message) => ({
        text: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
        rowId: message.id as string | undefined
      })),
    ...alsoShown.map((text) => ({ text, rowId: undefined }))
  ]
    .map((entry) => ({ key: landedKey(entry.text), rowId: entry.rowId }))
    .filter((entry) => entry.key.length > 0)
  // A row a later hook submission of the same words owns is that
  // submission's, not an earlier copy's (desk-prompt-row-owners.ts).
  const owners = rowOwners(prompts, raw, landedKey)
  return prompts.filter((prompt) => {
    if (photosOnlyPrompt(prompt.text) > 0) {
      return !landedMarkers.has(markersOf(prompt.text))
    }
    const key = landedKey(prompt.text)
    const place = owners.size > 0 ? placeOfCopy(prompt, raw) : null
    // A prompt the hook had to shorten can only ever be matched as a prefix
    // of the row that landed. The hook says when it shortened one; guessing
    // from the length was wrong whenever escapes or multibyte text moved the
    // boundary (2026-09-13).
    return !seen.some(
      (other) =>
        (other.key === key || (prompt.cut === true && key.length > 0 && other.key.startsWith(key))) &&
        !(
          place !== null &&
          other.rowId !== undefined &&
          ownedByLaterSubmission(owners.get(other.rowId), place) &&
          !joinedLineBetween(raw, place.position, raw.findIndex((message) => message.id === other.rowId), key, landedKey, owners)
        )
    )
  })
}

function markersOf(text: string): string {
  return (text.match(/\[Image #\d+\]/g) ?? []).join(' ')
}

/** The key a hook prompt is retired on. Painted, because `alsoShown` can hold
 *  a restored screen reading (no backticks); short-token, because the surfaced
 *  row of a plugin skill is `/name`, not `/plugin:name`; a lead's message in a
 *  teammate session by its words, because its row is surfaced as them and
 *  the hook's copy kept the wrapper, so the copy never retired and the
 *  follow-up drew twice (teammateTask; review of 2026-09-27). */
function landedKey(text: string): string {
  const words = teammateTask(text)?.text ?? text
  return normalizeNativeChatUserText(asPaintedPrompt(withShortSkillToken(withoutPasteWrappers(words))))
}
