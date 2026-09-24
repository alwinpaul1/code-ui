import type { DesktopPrompt } from './agent-hud-beacon'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'
import { withShortSkillToken } from './mobile-native-chat-command-turns'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import { deskEchoId } from './use-desktop-prompt-echoes'

/**
 * Which copy of a message is drawn when the phone holds one and the hook has
 * reported the same text (Orca's UserPromptSubmit hook, read off
 * `agentStatus.prompt`, which fires for every client's prompts, the phone's
 * too).
 *
 * The phone's own send wins. It holds the photos, which the hook's text never
 * carries, and it knows when it left the phone: it is drawn after the rows the
 * phone held then and any row written well before it (mid-turn-written-before.ts),
 * which is where the user asked for a mid-turn message to be drawn (2026-09-23).
 * The hook's copy is placed by its own clock instead, and Claude Code stamps a
 * row when it starts it, not when it writes it: a thinking row and a call
 * stamped 0.2 s before a send but written after it (session 967668df, 0-based
 * lines 8612–8617) fall above that copy, so a text send that stepped aside for it
 * drew under the call that ran after it. The hook's copy is left out instead.
 *
 * A copy with no send time of its own still steps aside: an echo restored from
 * a build that did not record `sentAt`, whose place was the phone's guess (it
 * drew three turns under the reply that answered it, device, 2026-09-19), and a
 * witness remembered from the hook or the queue box, which is the hook's copy
 * already.
 *
 * Copies pair one to one, per hook source. Matched as a set of texts, a
 * pending "yes" also hid a later "yes" typed at the desk, and a remembered
 * earlier one (review, 2026-09-24).
 */
// Painted on both sides: `pending` can hold a restored screen reading, which
// has no backticks, beside the hook's typed copy (review, 2026-09-19). The
// skill token is shortened after the markers go, because the hook reports a
// photo send as `[Image #20] /plugin:skill …` and the phone holds `/plugin:skill …`.
const key = (text: string) =>
  withShortSkillToken(normalizeNativeChatUserText(asPaintedPrompt(withoutPasteWrappers(text))))

type PendingCopy = { id: string; text: string; images?: string[]; sentAt?: number }

export type HookPairing = {
  /** Pending copies that give way to the hook's timed copy of them. */
  steppedAside: ReadonlySet<string>
  /** Hook prompts a drawn pending copy stands for: not drawn a second time. */
  standIns: ReadonlySet<string>
}

export function isTranscriptWitnessed(prompt: DesktopPrompt): boolean {
  return prompt.at !== undefined
}

/** A copy that keeps its bubble beside the hook's copy of it: it has photos
 *  the hook lacks, or it knows when it was sent. The pending store does not
 *  check the field it reads back, so a send time that is not a number is none. */
function holdsItsOwnPlace(item: PendingCopy): boolean {
  return Boolean(item.images?.length) || Number.isFinite(item.sentAt)
}

/** Whether a prompt reports this text: the same key, or a prompt the hook
 *  had to cut, as a prefix of it (the tab status caps the field at 200
 *  characters and says when it cut one). */
function reports(prompt: DesktopPrompt, promptKey: string, copyKey: string): boolean {
  return (
    promptKey.length > 0 &&
    (promptKey === copyKey || (prompt.cut === true && copyKey.startsWith(promptKey)))
  )
}

/** The prompt of one source timed nearest the send (an untimed one only when
 *  no timed one reports it). No lower bound: after a relaunch the status copy
 *  is timed by when the pane's state began, which can be well before the send. */
function nearestCopy(
  sentAt: number | undefined,
  open: readonly number[],
  prompts: readonly DesktopPrompt[]
): number | undefined {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
    return open[0]
  }
  let best: number | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const index of open) {
    const at = prompts[index]!.at
    const distance = at === undefined ? Number.MAX_VALUE : Math.abs(at - sentAt)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

const sourceOf = (prompt: DesktopPrompt) =>
  prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) ? 'status' : 'beacon'

/** Pair the phone's pending copies with the hook's prompts.
 *
 *  The phone's own sends go first. Each claims the copy of it nearest its send
 *  in each source, the tab status and the beacon, since both report every
 *  submission once and mergeDesktopPrompts keeps both when their texts differ.
 *  A prompt the pending store already remembers as someone else's message
 *  (`desk-<nonce>`) is never claimed. A copy with no place of its own then
 *  gives way to one unclaimed timed prompt of its text, its own first, or,
 *  with none, stands for an untimed one (2026-09-13). */
export function pairPendingWithHookPrompts(
  pending: readonly PendingCopy[],
  prompts: readonly DesktopPrompt[]
): HookPairing {
  const keys = prompts.map((prompt) => key(prompt.text))
  const remembered = new Set(pending.map((item) => item.id))
  const taken = new Set<number>()
  const standIns = new Set<string>()
  const steppedAside = new Set<string>()
  const open = (text: string, include: (prompt: DesktopPrompt) => boolean): number[] => {
    const copyKey = key(text)
    return keys.flatMap((promptKey, index) => {
      const prompt = prompts[index]!
      return !taken.has(index) && include(prompt) && reports(prompt, promptKey, copyKey) ? [index] : []
    })
  }
  const notSomeoneElses = (prompt: DesktopPrompt) => !remembered.has(deskEchoId(prompt.nonce))
  const claim = (index: number, hide: boolean) => {
    taken.add(index)
    if (hide) {
      standIns.add(prompts[index]!.nonce)
    }
  }
  for (const item of pending.filter(holdsItsOwnPlace)) {
    for (const source of ['status', 'beacon'] as const) {
      const ofSource = (prompt: DesktopPrompt) => sourceOf(prompt) === source && notSomeoneElses(prompt)
      const copy = nearestCopy(item.sentAt, open(item.text, ofSource), prompts)
      if (copy !== undefined) {
        claim(copy, true)
      }
    }
  }
  for (const item of pending.filter((candidate) => !holdsItsOwnPlace(candidate))) {
    const candidates = open(item.text, () => true)
    const timed = candidates.filter((index) => isTranscriptWitnessed(prompts[index]!))
    const own = timed.find((index) => deskEchoId(prompts[index]!.nonce) === item.id)
    if (timed.length > 0) {
      claim(own ?? timed[0]!, false)
      steppedAside.add(item.id)
    } else if (candidates[0] !== undefined) {
      claim(candidates[0], true)
    }
  }
  return { steppedAside, standIns }
}

/** The hook prompts no pending copy stands for.
 *
 *  The caller still filters them against the agent's QUEUE BOX: a message
 *  sent while the agent is busy sits there, the hook fires on submit, and its
 *  copy was drawn as a bubble ABOVE the queue row that still showed the
 *  message — the same text twice until the agent took it (device,
 *  2026-09-19). That was a phone send whose bubble had stepped aside for the
 *  hook's copy; a phone send no longer does, but a message typed at the desk
 *  or in the Claude app has only the hook's copy, and it queues the same way. */
export function promptsNoCopyStandsFor<T extends DesktopPrompt>(
  prompts: readonly T[],
  pairing: HookPairing
): T[] {
  return pairing.standIns.size === 0
    ? [...prompts]
    : prompts.filter((prompt) => !pairing.standIns.has(prompt.nonce))
}

/**
 * The bubbles in the order they were sent. Bubbles that follow the same row
 * are drawn in list order, and the phone's sends came first, so a message
 * typed at the desk before a phone send, with no row written between them,
 * drew below it (review, 2026-09-24). The phone's copies and the hook's are
 * merged by time, each list kept in its own order. The phone's clock and the
 * desk's can differ, so two sent within that slack may still swap. A copy of
 * the phone's with no time keeps its place ahead of the hook's, as before.
 */
export function inSendOrder<T extends { sentAt?: number }>(
  own: readonly T[],
  hookCopies: readonly T[],
  timeOf: (copy: T) => number | undefined
): T[] {
  const out: T[] = []
  let a = 0
  let b = 0
  while (a < own.length || b < hookCopies.length) {
    const mine = own[a]
    const theirs = hookCopies[b]
    const mineAt =
      mine !== undefined && typeof mine.sentAt === 'number' && Number.isFinite(mine.sentAt)
        ? mine.sentAt
        : Number.NEGATIVE_INFINITY
    const theirsAt =
      theirs === undefined ? Number.POSITIVE_INFINITY : (timeOf(theirs) ?? Number.POSITIVE_INFINITY)
    if (mine !== undefined && (theirs === undefined || mineAt <= theirsAt)) {
      out.push(mine)
      a += 1
    } else if (theirs !== undefined) {
      out.push(theirs)
      b += 1
    }
  }
  return out
}
