import { useMemo, useRef } from 'react'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { landedKey } from './desk-prompt-landed'
import { absorbedMemoryId } from './mobile-native-chat-witness-memory'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { BoxSighting } from './use-absorbed-queue-echoes'

/**
 * A queued message recalled into the agent's input is not a message sent.
 *
 * Both agents recall their queue into their own input: Claude Code's Up (the
 * stock build pulls the whole queue, one message per line; with
 * CLAUDE_CODE_KB_COHESION_FIXES its selector pulls one), Codex's Alt+Up (the
 * last one). The phone's pencil and tap-to-edit drive exactly those keys
 * (native-queue-editor.ts). Either way the entry leaves the queue box, which
 * is also what the box shows when the agent TAKES a message mid-turn, and the
 * queue-box witness (use-absorbed-queue-echoes.ts) drew every departure as a
 * message sent. So an edit drew the message as a sent bubble while it sat in
 * the input, and once it was queued again that bubble stayed beside the
 * queue's own row of it. Reported 2026-10-15 on 0.9.150 ("I tried to edit a
 * queued job and it got duplicated"): Claude Code's transcript for that
 * session holds `enqueue` 07:06:06.543, `popAll` 07:06:32.060 (the recall),
 * `enqueue` 07:06:38.098 (sent again), and one `remove` with reason
 * `absorbed_mid_turn` at 07:12:32.883. The agent had the message exactly once
 * throughout; the phone drew it twice.
 *
 * Two things tell a recall from a take. The phone's own recalls are noted by
 * the queue editor (notePhoneQueueRecall), which knows what it pulled out.
 * For a recall made at the desk, the agent's own input on the same read
 * (Orca's `draft`, QueueBoxRead.input) holds the words that left, and after a
 * take it does not. That is matched strictly (`entriesRecalledInto`): the
 * input is exactly one departed entry, or exactly every departed entry in
 * order, one per line, as the stock Claude recall writes them. Anything else
 * is read as before, a take.
 *
 * Once recalled, the box witness forgets the entry, and the copies the chat
 * held of the message are withdrawn for good (retireRecalledCopies): the
 * newest desk copy of its words (Orca's hook or status copy of the
 * submission) and the box's stored witness of the entry. Whatever the person
 * does next is a new message with copies of its own: sent again from the
 * phone composer it is the phone's own send, saved from the sheet it is a new
 * entry in the box and, on a tab with the prompt hook, a new hook copy.
 */

/** The key every witness compares words on (use-absorbed-queue-echoes.ts). */
function wordsKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(text))
}

/** Claude's queue box cuts a long entry with `…`: the words before it. */
function boxStem(key: string): string | null {
  const match = /^(.*?)\s*…$/.exec(key)
  const stem = match?.[1] ?? ''
  return stem.length >= 12 ? stem : null
}

/** Whether `full` is the message the box entry `entry` reads: its words, or
 *  the words the box's `…` stub of it begins with. */
function readsAs(full: string, entry: string): boolean {
  if (full === entry) {
    return true
  }
  const stem = boxStem(entry)
  return stem !== null && full.startsWith(stem)
}

/** Whether two readings of a queued message are one: the same words, or the
 *  box's `…` stub of the other. */
export function sameRecalledWords(a: string, b: string): boolean {
  const keyA = wordsKey(a)
  const keyB = wordsKey(b)
  return keyA.length > 0 && (readsAs(keyA, keyB) || readsAs(keyB, keyA))
}

/**
 * Which of the entries that left the box on this read went into the agent's
 * input (`input`, the words Orca publishes for it). Strict on purpose: a
 * departure the input does not account for exactly is a take, as it always
 * was, so a message the agent took is never hidden because the person
 * happened to be typing similar words.
 */
export function entriesRecalledInto(left: readonly string[], input: string): boolean[] {
  const inputKey = wordsKey(input)
  if (inputKey.length === 0 || left.length === 0) {
    return left.map(() => false)
  }
  const keys = left.map(wordsKey)
  // The stock Claude recall: the whole queue, one message per line.
  if (left.length > 1 && keys.join(' ') === inputKey) {
    return left.map(() => true)
  }
  const one = keys.findIndex((key) => key.length > 0 && readsAs(inputKey, key))
  return left.map((_, index) => index === one)
}

/** What one read found recalled for editing: the entries the queue-box
 *  witness forgets (`forget`), and the messages whose copies the chat
 *  withdraws (`retire`). */
export type QueueRecalls = { forget: readonly string[]; retire: readonly string[] }

/**
 * The queued messages this read finds recalled for editing: the recalls the
 * phone made itself (notePhoneQueueRecall), on the first read after them, and
 * entries the box let go of into the agent's own input (entriesRecalledInto),
 * the desk's Up included. Each read is judged once, on the render that first
 * sees it; a read that could not see the box changes nothing
 * (mobile-terminal-queue-read.ts). The queue-box witness forgets these
 * entries rather than drawing them as taken (use-absorbed-queue-echoes.ts),
 * and the chat withdraws their copies (retireRecalledCopies).
 *
 * The phone's recall is settled by the first read after it, whatever that
 * read lists: the editor notes only a recall that did take the message out
 * of the queue, so a box that lists its words again lists a new submission
 * (sent straight back from the composer, saved unchanged), and the copies of
 * the old one go either way. A read asked for before the recall and landing
 * after it still lists the old entry; its departure into the input on the
 * next read is then forgotten too, but nothing is withdrawn twice
 * (PHONE_RECALL_STALE_READ_MS).
 */
export function useQueueRecalls(scopeKey: string, queued: readonly string[], readable: boolean, input: string): QueueRecalls {
  const last = useRef<{ scopeKey: string; queued: readonly string[]; read: string } | null>(null)
  /** Phone recalls settled on a read that still listed their words. */
  const settledListed = useRef<{ text: string; at: number }[]>([])
  if (last.current?.scopeKey !== scopeKey) {
    last.current = { scopeKey, queued: [], read: '' }
    settledListed.current = []
  }
  if (!readable) {
    return NO_RECALLS
  }
  // The phone's own recalls are settled on every render that holds a read,
  // the same read drawn again included: each is used up when it settles.
  const settled = settlePhoneQueueRecalls(queued, settledListed.current)
  const byPhone = settled.byPhone
  settledListed.current = settled.listed
  const read = JSON.stringify([queued, input])
  // A read's departures are judged once: the copies they withdraw are
  // withdrawn for good, and judged again on a re-render they would withdraw
  // the next older copy of their words.
  if (read === last.current.read) {
    return byPhone.length > 0 ? { forget: byPhone, retire: byPhone } : NO_RECALLS
  }
  const before = last.current.queued
  last.current = { scopeKey, queued: [...queued], read }
  const open = [...queued]
  const left: string[] = []
  for (const text of before) {
    const match = open.findIndex((now) => sameRecalledWords(now, text))
    if (match === -1) {
      left.push(text)
    } else {
      open.splice(match, 1)
    }
  }
  const intoInput = entriesRecalledInto(left, input)
  const forget = [...byPhone]
  const retire = [...byPhone]
  for (const [index, text] of left.entries()) {
    if (!intoInput[index] || byPhone.some((recalled) => sameRecalledWords(recalled, text))) {
      continue
    }
    forget.push(text)
    // The phone's own recall of it, seen late: withdrawn already.
    const late = settledListed.current.findIndex((entry) => sameRecalledWords(entry.text, text))
    if (late === -1) {
      retire.push(text)
    } else {
      settledListed.current.splice(late, 1)
    }
  }
  return forget.length > 0 ? { forget, retire } : NO_RECALLS
}
const NO_RECALLS: QueueRecalls = { forget: [], retire: [] }
const NO_ENTRIES: readonly string[] = []
const NO_PROMPTS: readonly DesktopPrompt[] = []

/** Recalls the phone drove itself, oldest first. */
const phoneRecalls: { text: string; at: number }[] = []
/** How long a recall the phone made waits for a read of the box: past it,
 *  with no read in between, what the queue holds is unknown and the recall
 *  answers for nothing. Reads come once a second while the chat watches. */
export const PHONE_RECALL_WINDOW_MS = 30_000
/** How long after a phone recall settled on a read that still listed its
 *  words the departure of those words into the input is that same recall
 *  seen late (a read asked for before the recall; each is given 2.5 s,
 *  use-mobile-terminal-hud-observation.ts): forgotten, not withdrawn again. */
export const PHONE_RECALL_STALE_READ_MS = 3_000
const PHONE_RECALL_CAP = 32

/** The queue editor recalled these messages into the agent's input. */
export function notePhoneQueueRecall(texts: readonly string[], now = Date.now()): void {
  for (const text of texts) {
    if (wordsKey(text).length > 0) {
      phoneRecalls.push({ text, at: now })
    }
  }
  phoneRecalls.splice(0, Math.max(0, phoneRecalls.length - PHONE_RECALL_CAP))
}

/** The phone's recalls not yet settled, used up (`byPhone`). One past
 *  PHONE_RECALL_WINDOW_MS with no read between answers for nothing: what the
 *  queue holds by then is unknown. `listed` carries on the recalls settled on
 *  a read that still listed their words, for PHONE_RECALL_STALE_READ_MS. */
function settlePhoneQueueRecalls(
  queued: readonly string[],
  listed: readonly { text: string; at: number }[]
): { byPhone: string[]; listed: { text: string; at: number }[] } {
  const now = Date.now()
  const byPhone = phoneRecalls.filter((recall) => now - recall.at <= PHONE_RECALL_WINDOW_MS).map((recall) => recall.text)
  phoneRecalls.length = 0
  const still = listed.filter((settled) => now - settled.at <= PHONE_RECALL_STALE_READ_MS)
  for (const text of byPhone) {
    if (queued.some((entry) => sameRecalledWords(entry, text))) {
      still.push({ text, at: now })
    }
  }
  return { byPhone, listed: still }
}

/** The copies withdrawn because their message was recalled, per chat scope. */
type Retired = { pendingIds: Set<string>; deskNonces: Set<string> }
const retiredByScope = new Map<string, Retired>()
const RETIRED_SCOPE_CAP = 32
const NONE: Retired = { pendingIds: new Set(), deskNonces: new Set() }

/** The copies this scope has withdrawn so far. */
export function retiredCopies(scopeKey: string): Retired {
  return retiredByScope.get(scopeKey) ?? NONE
}

function retiredFor(scopeKey: string): Retired {
  let retired = retiredByScope.get(scopeKey)
  if (!retired) {
    retired = { pendingIds: new Set(), deskNonces: new Set() }
    retiredByScope.set(scopeKey, retired)
    for (const key of retiredByScope.keys()) {
      if (retiredByScope.size <= RETIRED_SCOPE_CAP) {
        break
      }
      retiredByScope.delete(key)
    }
  }
  return retired
}

/**
 * Withdraw the copies of each recalled message: the newest desk copy of its
 * words not yet withdrawn (Orca's hook or status copy of the submission; the
 * queued message is the latest submission of its words, an older copy an
 * earlier message already taken), and the stored witness of its box entry,
 * by the id the box's witness stored it under (`memoryIdOf`, from the box as
 * last read). Returns what this scope has withdrawn, these included.
 */
export function retireRecalledCopies(
  scopeKey: string,
  recalled: readonly string[],
  prompts: readonly DesktopPrompt[],
  memoryIdOf: (text: string) => string | null
): Retired {
  if (recalled.length === 0) {
    return retiredCopies(scopeKey)
  }
  const retired = retiredFor(scopeKey)
  for (const text of recalled) {
    const key = wordsKey(text)
    const desk = prompts.findLast((prompt) => {
      if (retired.deskNonces.has(prompt.nonce)) {
        return false
      }
      const copy = landedKey(prompt.text)
      // A copy the hook or Orca had to shorten is the start of the words.
      return readsAs(copy, key) || readsAs(key, copy) || (prompt.cut === true && copy.length > 0 && key.startsWith(copy))
    })
    if (desk) {
      retired.deskNonces.add(desk.nonce)
      retired.pendingIds.add(`desk-${desk.nonce}`)
    }
    const memory = memoryIdOf(text)
    if (memory !== null) {
      retired.pendingIds.add(memory)
    }
  }
  return retired
}

/**
 * The chat's side of a recall, for MobileNativeChatOverlay: the entries this
 * read found recalled (`recalled`, for the queue-box witness,
 * use-absorbed-queue-echoes.ts), and the phone's pending copies and desk
 * copies with every withdrawn copy taken out.
 *
 * `saw` keeps the box as the witness last read it, and hands the witness
 * back: a recalled entry's stored witness is withdrawn by the id the box's
 * witness stored it under (queuedDeskWitnesses). `listed` takes the
 * witnesses the box asserts now, and hands them back: an id withdrawn for a
 * recalled entry is given back when a message listed again is stored under
 * it, which is the same id whenever no row was written in between (the
 * message saved unchanged from the sheet, with no other copy to draw it).
 */
export function useRecalledQueueCopies<T extends { id: string }>(controller: {
  nativeChatStreamScopeKey: string
  nativeChatQueuedMessages?: readonly string[]
  nativeChatQueueReadable?: boolean
  nativeChatAgentInput?: string
  chatPending: readonly T[]
  nativeChatDesktopPrompts?: readonly DesktopPrompt[]
}): {
  recalled: readonly string[]
  pending: readonly T[]
  prompts: readonly DesktopPrompt[]
  saw: <W extends { box: readonly BoxSighting[] }>(witness: W) => W
  listed: <W extends readonly { id: string }[]>(witnesses: W) => W
} {
  const scopeKey = controller.nativeChatStreamScopeKey
  const readable = controller.nativeChatQueueReadable !== false
  const pending = controller.chatPending
  const prompts = controller.nativeChatDesktopPrompts ?? NO_PROMPTS
  const recalls = useQueueRecalls(scopeKey, controller.nativeChatQueuedMessages ?? NO_ENTRIES, readable, controller.nativeChatAgentInput ?? '')
  const lastBox = useRef<readonly BoxSighting[]>([])
  const retired = retireRecalledCopies(scopeKey, recalls.retire, prompts, (text) => {
    const slot = lastBox.current.findLast((entry) => sameRecalledWords(entry.text, text))
    return slot?.sighting ? absorbedMemoryId(slot.text, slot.sighting, slot.firstRead) : null
  })
  // `retired` changes in place; its size is its version.
  const version = retired.pendingIds.size + retired.deskNonces.size
  const kept = useMemo(
    () => (retired.pendingIds.size === 0 ? pending : pending.filter((item) => !retired.pendingIds.has(item.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, version]
  )
  const keptPrompts = useMemo(
    () => (retired.deskNonces.size === 0 ? prompts : prompts.filter((prompt) => !retired.deskNonces.has(prompt.nonce))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompts, version]
  )
  return {
    recalled: recalls.forget,
    pending: kept,
    prompts: keptPrompts,
    // A read that could not see the box keeps the box as last read.
    saw: (witness) => {
      if (readable) {
        lastBox.current = witness.box
      }
      return witness
    },
    listed: (witnesses) => {
      for (const witness of witnesses) {
        retired.pendingIds.delete(witness.id)
      }
      return witnesses
    }
  }
}

/** For tests: the recalls the phone has noted and no read has settled. */
export function phoneQueueRecallsForTests(): string[] {
  return phoneRecalls.map((recall) => recall.text)
}

/** For tests: each case is its own app launch. */
export function resetQueueRecallsForTests(): void {
  phoneRecalls.length = 0
  retiredByScope.clear()
}
