import { useStableEchoes } from './use-stable-echoes'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { withShortSkillToken } from './mobile-native-chat-command-turns'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'


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
 * never come — an older window, a compacted transcript — and a message with no
 * position must still be shown rather than hidden for good.
 */
const ANCHOR_WAIT_READINGS = 30
const waitsByNonce = new Map<string, number>()
/** The tail when a waiting prompt was FIRST seen, held still.
 *
 *  Read fresh each render instead, the provisional position followed the tail
 *  down as the turn wrote rows, and the prompt ended up below the reply it had
 *  caused — two of them stacking on the same last row (device screenshot,
 *  2026-09-15). The tail at first sighting is roughly where a mid-turn prompt
 *  belongs, which is what the code did before the waiting was added; the wait
 *  only ever UPGRADES it to the beaconed row. */
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
  hasEarlier = false
): MobileNativeChatPendingMessage[] {
  const echoes: MobileNativeChatPendingMessage[] = []
  for (const prompt of prompts) {
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
      const later = lastRowBefore(rawMessages, at)
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
    if (rememberedAnchor(prompt.nonce) === undefined && rawMessages.length > 0) {
      // The hook beacons the row that was last at SUBMIT time (`at=`). When
      // the phone holds that row, anchor there — however late the beacon
      // arrived, the message lands where the Claude app shows the record.
      // Only without it (an older hook, or the row paged out of the window)
      // does the arrival-time tail stand in (2026-09-14).
      const beaconed = prompt.anchorId
      const anchorRow =
        beaconed !== undefined ? rawMessages.find((message) => message.id === beaconed) : undefined
      // The transcript names the row it was written after, and that row is
      // often a tool call or result Orca never projects — so the id is never
      // held. The record's own time is enough: the last row written before
      // it is where it belongs. Without this the wait ran out and the echo
      // fell to the arrival tail, three turns under the reply that answered
      // it (device, 2026-09-19).
      const timedRow = anchorRow === undefined ? lastRowBefore(rawMessages, prompt.at) : undefined
      if (anchorRow) {
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
        rememberAnchor(prompt.nonce, rawMessages.at(-1)?.id ?? null)
      } else {
        const waited = (waitsByNonce.get(prompt.nonce) ?? 0) + 1
        waitsByNonce.set(prompt.nonce, waited)
        if (waited > ANCHOR_WAIT_READINGS) {
          waitsByNonce.delete(prompt.nonce)
          rememberAnchor(prompt.nonce, rawMessages.at(-1)?.id ?? null)
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
    // place beats correct and invisible.
    const settled = rememberedAnchor(prompt.nonce)
    if (settled === undefined && !provisionalByNonce.has(prompt.nonce)) {
      provisionalByNonce.set(prompt.nonce, rawMessages.at(-1)?.id ?? null)
    }
    const placement =
      settled === undefined ? (provisionalByNonce.get(prompt.nonce) ?? null) : settled
    echoes.push({
      id: `desk-${prompt.nonce}`,
      // The RAW text, marker and all. It is what this echo is matched against
      // when its transcript row lands — and `normalizeNativeChatUserText`
      // deletes `[Image #N]` from both sides, so the keys agree. Rewriting the
      // marker here instead made them diverge, and the echo could never retire:
      // the message drew twice, for good (2026-09-15). The placeholder the
      // reader sees is applied where the bubble is BUILT, not here.
      text: prompt.text,
      expectedOccurrence: 0,
      baselineTailMessageId: placement,
      baselineResolved: true
    })
  }
  return useStableEchoes(echoes)
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
  alsoShown: readonly string[] = []
): DesktopPrompt[] {
  const seen = [
    ...folded
      .filter((message) => message.role === 'user')
      .map((message) =>
        message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
      ),
    ...alsoShown
  ]
    .map(landedKey)
    .filter((text) => text.length > 0)
  return prompts.filter((prompt) => {
    const key = landedKey(prompt.text)
    // A prompt the hook had to shorten can only ever be matched as a prefix
    // of the row that landed. The hook says when it shortened one; guessing
    // from the length was wrong whenever escapes or multibyte text moved the
    // boundary (2026-09-13).
    return !seen.some(
      (other) => other === key || (prompt.cut === true && key.length > 0 && other.startsWith(key))
    )
  })
}

/** The key a hook prompt is retired on. Painted, because `alsoShown` can hold
 *  a restored screen reading (no backticks); short-token, because the surfaced
 *  row of a plugin skill is `/name`, not `/plugin:name`. */
function landedKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(withShortSkillToken(withoutPasteWrappers(text))))
}
