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
const hint = (text: string) =>
  /^Press up to (?:edit queued messages|select a queued message)\b/.test(text)
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const opaque = (text: string) => /\[(?:Image|Pasted (?:text|image))\b/i.test(text)

function checkScreen(agent: QueueEditorAgent, screen: QueueScreen) {
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

/** Recall the agent-owned input, including desktop-origin messages. Never seed
 * the editor from a queue preview: Codex truncates those to three lines. */
export async function recallNativeQueue(
  io: QueueEditorIo,
  agent: QueueEditorAgent
): Promise<string> {
  const before = await io.read()
  checkScreen(agent, before)
  if (before.draft && !hint(before.draft)) {
    throw new Error('Finish or clear the current draft before editing the queue.')
  }
  const queue = queueFromScreen(agent, before)
  if (
    agent === 'claude' &&
    queue.length > 1 &&
    !/select a queued message/.test([before.draft, ...before.lines].join(' '))
  ) {
    throw new Error(
      'This Claude version recalls the whole queue. Multiple messages need its per-message queue selector.'
    )
  }
  if (!queue.length) {
    throw new Error('That message is no longer queued.')
  }
  if (agent === 'codex' && !/edit last queued message/.test(normalize(before.lines.join(' ')))) {
    throw new Error('Codex is not exposing an editable queue right now. Refresh and try again.')
  }
  await io.write(agent === 'codex' ? '\x1b[1;3A' : '\x1b[A')
  let selected = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    checkScreen(agent, screen)
    const selectHint = [screen.draft, ...screen.lines].join('\n')
    if (agent === 'claude' && /Press Enter to edit the selected message/.test(selectHint)) {
      if (!selected) {
        selected = true
        await io.write('\r')
      }
      continue
    }
    if (screen.draft && !hint(screen.draft) && screen.draft !== before.draft) {
      return screen.draft
    }
  }
  throw new Error('Could not read the recalled message. Its original input remains on the agent.')
}

/** Save uses the original draft as a compare-before-write guard. Unchanged
 * restoration preserves opaque attachment/paste state without clearing it. */
export async function finishNativeQueueEdit(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  original: string,
  replacement: string | null,
  onReplaced?: (text: string) => void
): Promise<void> {
  const before = await io.read()
  checkScreen(agent, before)
  if (before.draft !== original) {
    throw new Error('The draft changed on desktop. Reopen the editor before saving.')
  }
  const text = replacement?.trim() ?? ''
  if (text !== original) {
    if (opaque(original)) {
      throw new Error(
        'This input contains an attachment or collapsed paste that Orca cannot expose for editing.'
      )
    }
    if (
      [...text].some(
        (char) =>
          (char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t') || char.charCodeAt(0) === 127
      )
    ) {
      throw new Error('Remove control characters before saving.')
    }
    // Claude can apply a paste in the same event batch against the pre-clear
    // value. Observe an empty input before pasting, using paced clear keys.
    let remaining = original
    for (let attempt = 0; remaining && attempt < 80; attempt++) {
      await io.write(attempt % 2 === 0 ? '\x15' : '\x0b')
      await io.pause()
      const cleared = await io.read()
      checkScreen(agent, cleared)
      if (cleared.draft.length > remaining.length) {
        throw new Error('The input changed while clearing. It has not been submitted.')
      }
      remaining = cleared.draft
      onReplaced?.(remaining)
    }
    if (remaining) {
      throw new Error('Could not clear the agent input. It has not been submitted.')
    }
    if (!text) {
      return
    }
    await io.write(`\x1b[200~${text}\x1b[201~`)
    let verified = false
    for (let attempt = 0; attempt < 20; attempt++) {
      await io.pause()
      const screen = await io.read()
      checkScreen(agent, screen)
      if (screen.draft === text) {
        verified = true
        onReplaced?.(text)
        break
      }
    }
    if (!verified) {
      throw new Error('The edited input could not be confirmed. It has not been submitted.')
    }
  }
  if (!text) {
    return
  }
  // Tab queues without interrupting Codex. An idle submission must additionally
  // pass Orca’s host-side sendable guard; a stale screen cannot steer a new turn.
  const ready = await io.read()
  checkScreen(agent, ready)
  if (ready.draft !== text) {
    throw new Error('The draft changed on desktop before submission.')
  }
  await io.write(agent === 'codex' ? '\t' : '\r')
  let submittedIdle = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    if (
      queueFromScreen(agent, screen).some((entry) => normalize(entry) === normalize(text)) ||
      !screen.draft ||
      hint(screen.draft)
    ) {
      return
    }
    if (
      agent === 'codex' &&
      attempt >= 2 &&
      !submittedIdle &&
      screen.draft === text &&
      !isCodexWorking(screen.lines)
    ) {
      submittedIdle = true
      await io.write('\r', true)
    }
  }
  throw new Error('The agent finished working. Your edited message remains in its input, unsent.')
}
