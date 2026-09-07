import { isCodexWorking } from './codex-picker-screen'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { claudePermissionFromScreen } from './claude-terminal-permission'

export type QueueEditorAgent = 'claude' | 'codex'
export type QueueScreen = { lines: string[]; draft: string; source: string }
export type QueueEditorIo = {
  read: () => Promise<QueueScreen>
  write: (text: string, idleOnly?: boolean) => Promise<void>
  pause: () => Promise<void>
}
export const hint = (text: string) =>
  /^Press (?:up to (?:edit queued messages|select a queued message)|Enter to edit the selected message)\b/.test(
    text
  )
/** Orca republishes Claude's composer placeholder in `draft`, so an empty input
 * arrives as the queue hint. Reading that as text makes a cleared input look
 * like it grew, which aborted the save after the entry had already left the
 * queue — the edited message was then lost. An input showing a hint is empty. */
export const draftOf = (screen: QueueScreen) => (hint(screen.draft) ? '' : screen.draft)
export const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
/** A queue caption is the message as Claude drew it: wrapped, and shortened
 * with an ellipsis when it is very long. Either side may be the shorter one. */
export const sameEntry = (draft: string, caption: string) => {
  const text = normalize(draft)
  const drawn = normalize(caption)
    .replace(/(?:\u2026|\.{3})$/, '')
    .trim()
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
  const words: { start: number; end: number; text: string }[] = []
  for (const match of draft.matchAll(/\S+/g)) {
    words.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
  }
  const segments: string[] = []
  let cursor = 0
  for (const entry of entries) {
    const wanted = entry.split(/\s+/).filter(Boolean)
    if (!wanted.length || cursor + wanted.length > words.length) {
      return null
    }
    for (let i = 0; i < wanted.length; i++) {
      if (words[cursor + i]!.text !== wanted[i]) {
        return null
      }
    }
    segments.push(draft.slice(words[cursor]!.start, words[cursor + wanted.length - 1]!.end))
    cursor += wanted.length
  }
  return cursor === words.length ? segments : null
}

/** Claude applies a paste in the same event batch as the keys before it, so the
 * input must be observed empty before anything is pasted into it. */
export async function clearInput(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  from: string,
  onReplaced?: (text: string) => void
): Promise<void> {
  let remaining = from
  for (let attempt = 0; remaining && attempt < 80; attempt++) {
    await io.write(attempt % 2 === 0 ? '\x15' : '\x0b')
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
  text: string
): Promise<void> {
  // Tab queues without interrupting Codex. An idle submission must additionally
  // pass Orca's host-side sendable guard; a stale screen cannot steer a new turn.
  const ready = await io.read()
  checkScreen(agent, ready)
  if (draftOf(ready) !== text) {
    throw new Error('The draft changed on desktop before submission.')
  }
  await io.write(agent === 'codex' ? '\t' : '\r')
  let submittedIdle = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    if (
      queueFromScreen(agent, screen).some((entry) => normalize(entry) === normalize(text)) ||
      !draftOf(screen)
    ) {
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
