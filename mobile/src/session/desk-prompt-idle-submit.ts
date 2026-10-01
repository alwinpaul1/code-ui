import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { landedKey } from './desk-prompt-landed'
import { photosOnlyPrompt } from './mobile-native-chat-image-transcript-markers'

/**
 * A loop's tick on a tab with no prompt hook, told from a typed prompt by what
 * the transcript says after it.
 *
 * Orca's status copy of a prompt that began a working run (`idleSubmit`,
 * agent-status-prompts.ts) is what a tick looks like with no hook: the tick has
 * no `sc=1` mark to carry, and when its loop's call was never loaded no words
 * to match (scheduled-prompt-ticks.ts). A prompt typed at an idle pane looks the
 * same. What differs is the transcript: Claude Code writes a typed prompt as a
 * user row of its words before the agent answers, and a tick as an `isMeta`
 * row Orca draws nothing for (fixtures/claude-scheduled-tick-2.1.286.ts). So
 * such a copy is not drawn until the rows say which it is:
 *
 *  - a user row of its words stamped at or just before its time: it was typed;
 *    the copy is let through as before and the landed-prompt rule retires it
 *    against that row (desk-prompt-landed.ts);
 *  - otherwise an assistant row stamped after it, with the held rows reaching
 *    back before it: the turn answered with no user row of its words, so it
 *    was a tick. The copy is dropped, and the words are remembered for the
 *    session (scheduled-prompt-memory.ts) once a SECOND copy of them is
 *    judged so: the memory loses a typed copy of those exact words its bubble
 *    until its row lands, so one verdict is not enough to write it;
 *  - otherwise it waits, and after NO_ROWS_WAIT_MS with the chat's read
 *    settled it is drawn as before, so a row that never loads costs the old
 *    behaviour and never a message.
 *
 * Holding a typed prompt's copy costs nothing a reader sees beyond the rows'
 * lag: the bubble is its row, and the copy only stood in for it.
 *
 * Refused rather than guessed: a copy of no words, a photo-only send, and any
 * prompt that starts with `/` (a slash command's row is an envelope the words
 * do not match) are never held or dropped.
 *
 * Not covered, and drawn as before: a tick that fires mid-turn (the run did
 * not begin with it, so the reader does not mark it), a pane kept `working`
 * by background inventory, a hook copy with no status twin, a status read
 * after a later tool ping moved `updatedAt` past the slack, and a tab with the
 * prompt hook (its copies carry the mark: scheduled-prompt-ticks.ts).
 */

/** How long a copy waits for any row to decide it. */
export const NO_ROWS_WAIT_MS = 30_000
/** How long before a copy's time a row may be stamped and still be its row
 *  (the phone's other sends allow the same second: use-desktop-prompt-echoes.ts). */
const ROW_SLACK_MS = 1000
const DECIDED_CAP = 256
const WORDS_CAP = 64

type Verdict = 'draw' | 'tick'

/** What each copy was judged, by nonce, so a verdict holds once the rows move on. */
const decided = new Map<string, Verdict>()
/** The copies judged ticks, by session and words: a second one teaches the session. */
const ticksByWords = new Map<string, { words: string; cut: boolean; nonces: Set<string> }>()

export type IdleSubmitGate = {
  /** The tab's agent and whether it was launched with the prompt hook: the
   *  gate acts on a Claude tab with no hook only. */
  agent: string | null | undefined
  promptHook: boolean | null | undefined
  /** Whether the chat's read of the session has settled (nothing says a row is
   *  missing before it does). */
  readSettled: boolean
}

export type IdleGateResult = {
  kept: readonly DesktopPrompt[]
  /** The copies judged ticks, each with the words it was judged by. */
  ticks: readonly DesktopPrompt[]
  /** The words to remember for the session: a second copy was judged a tick. */
  learned: readonly { words: string; cut: boolean }[]
  /** When the earliest held copy may be drawn without a row, or undefined. */
  deadline: number | undefined
}

const NO_LEARNED: IdleGateResult['learned'] = []
const NO_TICKS: IdleGateResult['ticks'] = []

function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function userWords(message: NativeChatMessage): string {
  return message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** Claude tabs with no prompt hook only: with it a tick's copy carries the
 *  mark, and Codex writes its rows differently (its ticks are not seen). */
export function gateApplies(gate: IdleSubmitGate): boolean {
  return gate.agent === 'claude' && gate.promptHook !== true
}

/** Whether the gate looks at the copy at all. */
function isGated(prompt: DesktopPrompt): prompt is DesktopPrompt & { at: number } {
  return (
    prompt.idleSubmit === true &&
    typeof prompt.at === 'number' &&
    Number.isFinite(prompt.at) &&
    !prompt.text.startsWith('/') &&
    photosOnlyPrompt(prompt.text) === 0 &&
    landedKey(prompt.text).length > 0
  )
}

function verdictFor(
  prompt: DesktopPrompt & { at: number },
  messages: readonly NativeChatMessage[],
  readSettled: boolean,
  now: number
): Verdict | 'hold' {
  const key = landedKey(prompt.text)
  let reachesBack = false
  let replied = false
  for (const message of messages) {
    if (message.timestamp === null) {
      continue
    }
    if (message.timestamp < prompt.at - ROW_SLACK_MS) {
      reachesBack = true
      continue
    }
    if (message.role === 'user') {
      const row = landedKey(userWords(message))
      if (row.length > 0 && (row === key || (prompt.cut === true && row.startsWith(key)))) {
        return 'draw'
      }
    } else if (message.role === 'assistant' && message.timestamp > prompt.at) {
      replied = true
    }
  }
  if (replied && reachesBack) {
    return 'tick'
  }
  const waited = typeof prompt.seenAt === 'number' ? now - prompt.seenAt : 0
  return readSettled && waited >= NO_ROWS_WAIT_MS ? 'draw' : 'hold'
}

function decide(nonce: string, verdict: Verdict): void {
  decided.delete(nonce)
  if (decided.size >= DECIDED_CAP) {
    const oldest = decided.keys().next()
    if (!oldest.done) {
      decided.delete(oldest.value)
    }
  }
  decided.set(nonce, verdict)
}

function noteTick(sessionId: string | null | undefined, prompt: DesktopPrompt): void {
  const words = folded(prompt.text)
  const key = `${sessionId ?? ''}\u0000${words}`
  let entry = ticksByWords.get(key)
  if (entry === undefined) {
    if (ticksByWords.size >= WORDS_CAP) {
      const oldest = ticksByWords.keys().next()
      if (!oldest.done) {
        ticksByWords.delete(oldest.value)
      }
    }
    entry = { words, cut: prompt.cut === true, nonces: new Set() }
    ticksByWords.set(key, entry)
  }
  entry.nonces.add(prompt.nonce)
}

/**
 * `prompts` less the copies the rows show to be a loop's tick, and less the
 * copies still waiting for rows. The same array when no copy is gated.
 */
export function gateIdleSubmits(
  prompts: readonly DesktopPrompt[],
  messages: readonly NativeChatMessage[],
  sessionId: string | null | undefined,
  gate: IdleSubmitGate,
  now: number = Date.now()
): IdleGateResult {
  if (!gateApplies(gate) || prompts.length === 0 || !prompts.some(isGated)) {
    return { kept: prompts, ticks: NO_TICKS, learned: NO_LEARNED, deadline: undefined }
  }
  const kept: DesktopPrompt[] = []
  const ticks: DesktopPrompt[] = []
  let deadline: number | undefined
  for (const prompt of prompts) {
    if (!isGated(prompt)) {
      kept.push(prompt)
      continue
    }
    const before = decided.get(prompt.nonce)
    const verdict = before ?? verdictFor(prompt, messages, gate.readSettled, now)
    if (verdict === 'hold') {
      if (gate.readSettled && typeof prompt.seenAt === 'number') {
        const due = prompt.seenAt + NO_ROWS_WAIT_MS
        deadline = deadline === undefined ? due : Math.min(deadline, due)
      }
      continue
    }
    if (before === undefined) {
      decide(prompt.nonce, verdict)
    }
    if (verdict === 'tick') {
      noteTick(sessionId, prompt)
      ticks.push(prompt)
    } else {
      kept.push(prompt)
    }
  }
  const learned = ticks.flatMap((prompt) => {
    const entry = ticksByWords.get(`${sessionId ?? ''}\u0000${folded(prompt.text)}`)
    return entry !== undefined && entry.nonces.size >= 2 ? [{ words: entry.words, cut: entry.cut }] : []
  })
  return {
    kept: kept.length === prompts.length ? prompts : kept,
    ticks: ticks.length === 0 ? NO_TICKS : ticks,
    learned: learned.length === 0 ? NO_LEARNED : learned,
    deadline
  }
}

/** Test-only: a fresh process. */
export function resetIdleSubmitForTests(): void {
  decided.clear()
  ticksByWords.clear()
}
