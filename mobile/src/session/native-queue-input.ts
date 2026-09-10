import { isCodexWorking } from './codex-picker-screen'
import {
  QUEUE_HINT,
  queuedMessagesFromScreen,
  SELECTED_HINT
} from './mobile-terminal-queued-messages'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { AGENT_TUI_MAX_KEY_WRITE_BYTES } from './agent-tui-clear-write-chunks'

/** Each pair is two bytes, so this keeps a burst strictly under the bound. */
const MAX_QUEUE_CLEAR_PAIRS_PER_WRITE = Math.floor((AGENT_TUI_MAX_KEY_WRITE_BYTES - 1) / 2)

export type QueueEditorAgent = 'claude' | 'codex'
export type QueueScreen = { lines: string[]; draft: string; source: string }
export type QueueEditorIo = {
  read: () => Promise<QueueScreen>
  write: (text: string, idleOnly?: boolean) => Promise<void>
  pause: () => Promise<void>
}
/** The same two shapes the screen parser anchors on. Drift here is a loss
 * path: a hint `draftOf` reads as text makes a cleared composer look like it
 * grew, and the save aborts after the queue has already been emptied. */
export const hint = (text: string) => QUEUE_HINT.test(text) || SELECTED_HINT.test(text)
/** Orca republishes Claude's composer placeholder in `draft`, so an empty input
 * arrives as the queue hint. Reading that as text makes a cleared input look
 * like it grew, which aborted the save after the entry had already left the
 * queue — the edited message was then lost. An input showing a hint is empty. */
export const draftOf = (screen: QueueScreen) => (hint(screen.draft) ? '' : screen.draft)
export const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
/** Claude wraps a token longer than the pane with no space at the break, so a
 * caption's whitespace is not the author's. Compare only the printing
 * characters: a word-by-word match refused a queue holding a long URL or path,
 * and it refused it after the recall had already emptied the queue. */
const dense = (text: string) => text.replace(/\s+/g, '')
/** The one comparator for "is this drawn row the message I sent". It must be
 * the same everywhere: matching a caption loosely in one place and strictly in
 * another means the queue that the loose test lets through is the queue the
 * strict test can never confirm, and the messages strand on the phone. */
export const sameText = (a: string, b: string) => dense(a) === dense(b)
/** A queue caption is the message as Claude drew it: wrapped, and shortened
 * with an ellipsis when it is very long. Either side may be the shorter one. */
export const sameEntry = (draft: string, caption: string) => {
  const text = dense(draft)
  const drawn = dense(caption).replace(/(?:\u2026|\.{3})$/, '')
  return drawn.length > 0 && (text.startsWith(drawn) || drawn.startsWith(text))
}
export const opaque = (text: string) => /\[(?:Image|Pasted (?:text|image))\b/i.test(text)
export const hasControlCharacters = (text: string) =>
  [...text].some(
    (char) =>
      (char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t') || char.charCodeAt(0) === 127
  )

export function checkScreen(agent: QueueEditorAgent, screen: QueueScreen) {
  if (
    screen.source !== 'screen' ||
    (agent === 'codex'
      ? codexPermissionFromScreen(screen.lines)
      : claudePermissionFromScreen(screen.lines))
  ) {
    throw new Error('The agent input is unavailable. Try again when its dialog closes.')
  }
}
export function queueFromScreen(agent: QueueEditorAgent, screen: QueueScreen) {
  return agent === 'codex'
    ? codexQueuedMessagesFromScreen(screen.lines)
    : queuedMessagesFromScreen(screen.lines, screen.draft)
}

/** Segment the recalled whole-queue draft back into the messages it was built
 * from, matching word for word against the captions Claude drew before the
 * recall. A caption's line breaks are display wrapping and the draft's are the
 * author's, so only the words line up; anything that does not, refuses. */
export function segmentRecalledQueue(draft: string, entries: readonly string[]): string[] | null {
  const at: number[] = []
  let packed = ''
  for (let i = 0; i < draft.length; i++) {
    const char = draft[i]!
    if (!/\s/.test(char)) {
      at.push(i)
      packed += char
    }
  }
  const segments: string[] = []
  let cursor = 0
  for (const entry of entries) {
    const wanted = dense(entry)
    if (!wanted || packed.slice(cursor, cursor + wanted.length) !== wanted) {
      return null
    }
    const last = at[cursor + wanted.length - 1]!
    const next = at[cursor + wanted.length]
    // Word matching enforced this for free: a boundary between two messages is
    // a newline in the recalled draft. Ignoring whitespace inside a caption must
    // not also let a truncated caption cut mid-token and shift every boundary
    // after it, which would mis-split silently instead of refusing.
    if (next !== undefined && next === last + 1) {
      return null
    }
    segments.push(draft.slice(at[cursor]!, last + 1))
    cursor += wanted.length
  }
  return cursor === packed.length ? segments : null
}

/** Claude applies a paste in the same event batch as the keys before it, so the
 * input must be observed empty before anything is pasted into it. */
export async function clearInput(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  from: string,
  onReplaced?: (text: string) => void,
  deadline?: number
): Promise<void> {
  // Every write and read is a relay round trip. Killing one line per trip cost
  // one round trip per line of a recalled queue, which dominated the save; send
  // a whole burst of kills at once and confirm the input empty before pasting.
  let remaining = from
  const clearBy = deadline ?? Date.now() + 8_000
  for (let attempt = 0; remaining && attempt < 12 && Date.now() < clearBy; attempt++) {
    // Over-killing an empty composer is a no-op, but another pass is a whole
    // relay round trip, so send enough kills to finish in one.
    // Capped so one write stays under the size an agent reads as pasted text
    // rather than as keys (AGENT_TUI_MAX_KEY_WRITE_BYTES, measured). The loop
    // above already sends another pass, and confirms the input between them.
    const burst = '\x15\x0b'.repeat(
      Math.min(remaining.split('\n').length * 2 + 4, MAX_QUEUE_CLEAR_PAIRS_PER_WRITE)
    )
    await io.write(burst)
    await io.pause()
    const cleared = await io.read()
    checkScreen(agent, cleared)
    if (draftOf(cleared).length > remaining.length) {
      throw new Error('The input changed while clearing. It has not been submitted.')
    }
    remaining = draftOf(cleared)
    onReplaced?.(remaining)
  }
  if (remaining) {
    throw new Error('Could not clear the agent input. It has not been submitted.')
  }
}

/** Paste and submit in one write. Confirming the draft before submitting cost a
 * round trip each way per message; the queue is the stronger confirmation
 * anyway, because it says what the agent actually took, so check that instead.
 *
 * Only one message may travel per write. Claude coalesces a write holding
 * several paste-and-submit pairs into a single paste and drops the submits
 * between them, which queues every message concatenated into one. */
/** The paste went out and the screen shows the text as a live prompt rather
 * than a queue row. The message may be running, so a caller must not assert
 * that it never reached the agent. */
export class QueueMaybeDeliveredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueueMaybeDeliveredError'
  }
}

export async function typeAndSubmit(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  text: string,
  /** How many entries equal to this text the queue must hold once it lands.
   *  Matching on presence alone lets a repeated message confirm itself from the
   *  copy already queued, and the next paste then joins one still in the
   *  composer. Counting is the difference between an edit and a silent merge. */
  expected = 1,
  deadline?: number
): Promise<void> {
  const key = agent === 'codex' ? '\t' : '\r'
  const landed = (screen: QueueScreen) =>
    queueFromScreen(agent, screen).filter((entry) => sameText(entry, text)).length >= expected &&
    !draftOf(screen)
  // A message the agent took as a live prompt is drawn in the transcript at
  // column zero, not indented like a queue row. Saying it was never sent would
  // send the user to re-add a prompt the agent is already running.
  const delivered = (screen: QueueScreen) =>
    screen.lines.some((line) => {
      if (!/^[❯›>]\s+\S/.test(line)) {
        return false
      }
      // Only the first line of a delivered message sits at column zero, so a
      // long one is a prefix of the text, never equal to it.
      const row = dense(line.replace(/^[❯›>]\s+/, ''))
      // Transcripts are full of short prompts ("ok", "yes", "continue"), and any
      // of them is a prefix of something longer. Require enough of the message
      // to be there before telling the user the agent may have run it.
      const want = dense(text)
      return row.length >= Math.min(want.length, 16) && want.startsWith(row)
    })
  await io.write(`\x1b[200~${text}\x1b[201~${key}`)
  let resent = false
  let probed = false
  const submitBy = deadline ?? Date.now() + 10_000
  // The paste and its submit key are already on the wire, so a budget that ran
  // out before this message must still buy one look: reporting a written
  // message unsent sends the user to queue it a second time.
  for (let attempt = 0; attempt < 25 && (attempt === 0 || Date.now() < submitBy); attempt++) {
    await io.pause()
    const screen = await io.read()
    checkScreen(agent, screen)
    if (landed(screen)) {
      return
    }
    // The text arrived but the key that follows it did not. Send it on its own
    // rather than spending the whole loop waiting for a submit that never came.
    // Re-read first: an Enter that lands on an already-empty composer is a
    // no-op on stock Claude, but its own hint offers to flush the whole queue,
    // and that behaviour is behind a gate this app cannot see.
    if (!probed && !resent && attempt >= 2 && draftOf(screen) === text) {
      probed = true
      const still = await io.read()
      checkScreen(agent, still)
      if (landed(still)) {
        return
      }
      if (draftOf(still) === text) {
        resent = true
        await io.write(key)
      }
    }
  }
  // The budget is shared across the whole rebuild, so the loop can run out one
  // read before the queue is checked. Look once more before calling it lost: a
  // message named as never put back sends the user to queue it a second time.
  const last = await io.read().catch(() => null)
  if (last && landed(last)) {
    return
  }
  if (last && delivered(last)) {
    throw new QueueMaybeDeliveredError(
      'The agent may have finished working and run this message as a prompt instead of queueing it. Check the desktop before sending it again.'
    )
  }
  throw new Error('The agent did not queue the message. It may have stopped working.')
}

export async function typeInput(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  text: string,
  onReplaced?: (value: string) => void
): Promise<void> {
  await io.write(`\x1b[200~${text}\x1b[201~`)
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    checkScreen(agent, screen)
    if (draftOf(screen) === text) {
      onReplaced?.(text)
      return
    }
  }
  throw new Error('The edited input could not be confirmed. It has not been submitted.')
}

export async function submitInput(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  text: string,
  /** Set when the caller's own read already saw this exact draft, which makes
   *  a second read of the same screen a wasted relay round trip. */
  confirmed = false
): Promise<void> {
  // Tab queues without interrupting Codex. An idle submission must additionally
  // pass Orca's host-side sendable guard; a stale screen cannot steer a new turn.
  if (!confirmed) {
    const ready = await io.read()
    checkScreen(agent, ready)
    if (draftOf(ready) !== text) {
      throw new Error('The draft changed on desktop before submission.')
    }
  }
  await io.write(agent === 'codex' ? '\t' : '\r')
  let submittedIdle = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    // An unchecked screen can be a permission dialog or a stream fallback, both
    // of which read as an empty draft and would report an unsent edit as saved.
    checkScreen(agent, screen)
    if (queueFromScreen(agent, screen).some((entry) => sameText(entry, text)) || !draftOf(screen)) {
      return
    }
    if (
      agent === 'codex' &&
      attempt >= 2 &&
      !submittedIdle &&
      draftOf(screen) === text &&
      !isCodexWorking(screen.lines)
    ) {
      submittedIdle = true
      await io.write('\r', true)
    }
  }
  throw new Error('The agent finished working. Your edited message remains in its input, unsent.')
}
