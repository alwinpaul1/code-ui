import { claudeQueueViewFromScreen, type ClaudeQueueView } from './mobile-terminal-queued-messages'
import {
  checkScreen,
  clearInput,
  draftOf,
  hasControlCharacters,
  hint,
  normalize,
  opaque,
  queueFromScreen,
  sameEntry,
  segmentRecalledQueue,
  submitInput,
  typeInput,
  type QueueEditorAgent,
  type QueueEditorIo
} from './native-queue-input'

export {
  queueFromScreen,
  segmentRecalledQueue,
  type QueueEditorAgent,
  type QueueEditorIo,
  type QueueScreen
} from './native-queue-input'

/** What one open editor needs to write its result back.
 * `segments` is set only on Claude's legacy whole-queue recall, where the whole
 * queue arrives as one draft and has to be retyped message by message. */
export type QueueEdit = {
  /** The message shown in the editor. */
  text: string
  /** The agent input as recall left it; the compare-before-write guard. */
  draft: string
  /** Every queued message in order, or null when the agent edits one natively. */
  segments: string[] | null
  index: number
}
/** Walk Claude's marker up to `index`, one press at a time, checking after each
 * that the marked row is still the message the user tapped. Claude renders the
 * unmarked rows exactly like wrapped continuation lines, so the marked caption
 * is the only trustworthy signal that the walk landed where it was aimed. */
async function selectClaudeEntry(
  io: QueueEditorIo,
  entries: readonly string[],
  index: number
): Promise<void> {
  const abandon = async (message: string) => {
    // Escape clears the selection before anything else reads it, so it cannot
    // interrupt the running turn. Leaving a stale marker would strand the
    // desktop in a state mobile refuses to open again.
    await io.write('\x1b').catch(() => {})
    throw new Error(message)
  }
  for (let step = 1; step <= entries.length - index; step++) {
    await io.write('\x1b[A')
    let view: ClaudeQueueView | null = null
    for (let attempt = 0; attempt < 20 && !view?.selecting; attempt++) {
      await io.pause()
      const screen = await io.read()
      checkScreen('claude', screen)
      view = claudeQueueViewFromScreen(screen.lines, screen.draft)
    }
    if (!view?.selecting) {
      throw new Error('Claude did not open its queue selector. Nothing was changed.')
    }
    const expected = entries[entries.length - step]
    if (!view.selected || !expected || !sameEntry(expected, view.selected)) {
      await abandon('The queue changed while selecting that message. Nothing was changed.')
    }
    const oldest = step === entries.length
    if (view.selectedOldest !== oldest) {
      await abandon('Could not confirm which message Claude selected. Nothing was changed.')
    }
  }
  await io.write('\r')
}

/** Recall the agent-owned input, including desktop-origin messages. Never seed
 * the editor from a queue preview: Codex truncates those to three lines.
 * `index` addresses the queue as drawn, oldest first. */
export async function recallNativeQueue(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  index?: number
): Promise<QueueEdit> {
  const before = await io.read()
  checkScreen(agent, before)
  if (before.draft && !hint(before.draft)) {
    throw new Error('Finish or clear the current draft before editing the queue.')
  }
  const view = agent === 'claude' ? claudeQueueViewFromScreen(before.lines, before.draft) : null
  if (view?.selecting) {
    throw new Error('A queued message is already selected on the desktop. Clear it there first.')
  }
  const queue = view ? view.entries : queueFromScreen(agent, before)
  if (!queue.length) {
    throw new Error('That message is no longer queued.')
  }
  const target = index ?? queue.length - 1
  if (target < 0 || target >= queue.length) {
    throw new Error('That message is no longer queued.')
  }
  // Claude's legacy recall empties the whole queue into one draft. Mobile puts
  // it back message by message rather than asking for a host-side flag, so the
  // rest of the queue must be recoverable from that draft before a key is sent.
  const rebuild = agent === 'claude' && !view!.selectable
  if (rebuild && queue.some(opaque)) {
    throw new Error(
      'A queued message holds an attachment or collapsed paste that Orca cannot retype.'
    )
  }
  if (agent === 'codex') {
    if (target !== queue.length - 1) {
      throw new Error('Codex can only edit its most recent queued message.')
    }
    if (!/edit last queued message/.test(normalize(before.lines.join(' ')))) {
      throw new Error('Codex is not exposing an editable queue right now. Refresh and try again.')
    }
    await io.write('\x1b[1;3A')
  } else if (view!.selectable) {
    await selectClaudeEntry(io, queue, target)
  } else {
    await io.write('\x1b[A')
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    await io.pause()
    const screen = await io.read()
    checkScreen(agent, screen)
    const draft = draftOf(screen)
    if (!draft || draft === before.draft) {
      continue
    }
    if (!rebuild) {
      if (agent === 'claude' && !sameEntry(draft, queue[target]!)) {
        throw new Error(
          'Claude recalled a different message than the one you tapped. It is now in the agent input, unsent.'
        )
      }
      return { text: draft, draft, segments: null, index: target }
    }
    const segments = segmentRecalledQueue(draft, queue)
    if (!segments) {
      throw new Error(
        'Claude recalled its queue as one draft that does not match the queued messages. They are in the agent input, unsent.'
      )
    }
    return { text: segments[target]!, draft, segments, index: target }
  }
  throw new Error(
    rebuild
      ? 'Claude moved the whole queue into its input and mobile could not read it back. Your messages are in the desktop input, unsent.'
      : 'Could not read the recalled message. Its original input remains on the agent.'
  )
}

/** Save uses the recalled draft as a compare-before-write guard. Unchanged
 * restoration preserves opaque attachment/paste state without clearing it.
 * A rebuild recall holds every queued message, so the whole queue is retyped
 * in its original order with one entry changed or dropped. */
export async function finishNativeQueueEdit(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  edit: QueueEdit,
  replacement: string | null,
  onReplaced?: (text: string) => void
): Promise<void> {
  const before = await io.read()
  checkScreen(agent, before)
  if (draftOf(before) !== edit.draft) {
    throw new Error('The draft changed on desktop. Reopen the editor before saving.')
  }
  const text = replacement?.trim() ?? ''
  if (hasControlCharacters(text)) {
    throw new Error('Remove control characters before saving.')
  }
  if (edit.segments) {
    await rebuildQueue(io, edit, text, onReplaced)
    return
  }
  if (text !== edit.draft) {
    if (opaque(edit.draft)) {
      throw new Error(
        'This input contains an attachment or collapsed paste that Orca cannot expose for editing.'
      )
    }
    await clearInput(io, agent, edit.draft, onReplaced)
    if (!text) {
      return
    }
    await typeInput(io, agent, text, onReplaced)
  }
  if (!text) {
    return
  }
  await submitInput(io, agent, text)
}

/** Retype the whole queue. Between the clear and the last submit the messages
 * live only on the phone, so every step is verified and a failure names the
 * messages that did not make it back rather than pretending they were sent. */
async function rebuildQueue(
  io: QueueEditorIo,
  edit: QueueEdit,
  text: string,
  onReplaced?: (value: string) => void
): Promise<void> {
  const parts = edit
    .segments!.map((part, at) => (at === edit.index ? text : part))
    .filter((part) => part.trim().length > 0)
  if (edit.segments!.some(opaque)) {
    throw new Error(
      'A queued message holds an attachment or collapsed paste that Orca cannot retype.'
    )
  }
  await clearInput(io, 'claude', edit.draft, onReplaced)
  for (let at = 0; at < parts.length; at++) {
    const part = parts[at]!
    try {
      await typeInput(io, 'claude', part, onReplaced)
      await submitInput(io, 'claude', part)
    } catch (cause) {
      const left = parts.slice(at)
      throw new Error(
        `${cause instanceof Error ? cause.message : 'The queue could not be rebuilt.'} ` +
          `${left.length} message${left.length === 1 ? '' : 's'} left the queue and ` +
          `${left.length === 1 ? 'was' : 'were'} not put back: ${left.map((item) => JSON.stringify(item)).join(', ')}`
      )
    }
  }
}
