import {
  SHELL_COMMAND_QUEUE_REBUILD_REFUSAL,
  SHELL_COMMAND_QUEUE_REFUSAL,
  shellCommandOfSend
} from './mobile-native-chat-shell-command'
import { claudeQueueViewFromScreen, type ClaudeQueueView } from './mobile-terminal-queued-messages'
import { queueRowIsPendingSend } from './mobile-terminal-queued-messages'
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
  QueueMaybeDeliveredError,
  sameText,
  segmentRecalledQueue,
  submitInput,
  typeAndSubmit,
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
  index?: number,
  /** The row the user actually tapped. The index came from a screen poll up to
   *  a second old; if the agent consumed a message in between, that index now
   *  addresses its neighbour — and Delete would silently take the wrong one. */
  tapped?: string
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
  // Orca publishes `draft` only when its own composer detector accepts the row
  // above Claude's `❯`, and it accepts only a bare rule. Under a rule that
  // carries the session name or the fast-mode tag `draft` is '' even while
  // Claude paints its queue placeholder, so after a recall the phone could not
  // read the queue back out of the input, and the next send cleared it
  // (Claude Code 2.1.285, review of 2026-09-30). The queue still shows; only
  // the editing is refused, and before any key is sent.
  if (agent === 'claude' && !before.draft) {
    throw new Error(
      'Edit this queued message on the desktop. Orca cannot read the input box on this screen, so the phone cannot recall the queue safely.'
    )
  }
  const target = index ?? queue.length - 1
  if (target < 0 || target >= queue.length) {
    throw new Error('That message is no longer queued.')
  }
  if (tapped !== undefined && !sameText(queue[target]!, tapped)) {
    throw new Error('The queue moved on before that opened. Reopen it and try again.')
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
    checkScreen(agent, screen, 'uncertain')
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
  checkScreen(agent, before, 'in-input')
  if (draftOf(before) !== edit.draft) {
    throw new Error('The draft changed on desktop. Reopen the editor before saving.')
  }
  // Trimmed at both ends, as it always was: the host reads the input back trimmed
  // (terminal-composer-draft.ts), so text typed with a leading space or newline would never read
  // back and the save would fail AFTER the clear and the paste had gone out.
  const text = replacement?.trim() ?? ''
  if (hasControlCharacters(text)) {
    throw new Error('Remove control characters before saving.')
  }
  // Typed into the emptied input, a leading `!` is a shell command (the chat asks first;
  // this sheet cannot). Judged on the trimmed text, which is what is typed: `  !cmd` would be
  // typed `!cmd`. Before any write, so nothing is cleared or lost. Text that is
  // already in the input (an unchanged restore) is not typed and is not judged.
  if (!edit.segments && text !== edit.draft && shellCommandOfSend(text, agent) !== null) {
    throw new Error(SHELL_COMMAND_QUEUE_REFUSAL)
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
      await confirmRemoved(io, agent, edit.text)
      return
    }
    await typeInput(io, agent, text, onReplaced)
    await submitInput(io, agent, text, true)
    return
  }
  if (!text) {
    return
  }
  await submitInput(io, agent, text)
}

/** A delete is finished only once the agent's own queue no longer holds it.
 *
 *  Clearing the composer is not the same thing: the recall is what takes an
 *  entry out of the queue, and on a build whose recall leaves it there, an
 *  emptied composer looked exactly like a successful delete — the message stayed
 *  queued and the editor closed anyway (reported from the phone, 2026-09-14).
 *  Every other path already confirms against the queue; this one did not. */
/** Every poll is a relay round trip; without a budget six of them could hold
 *  the sheet disabled for about sixteen seconds. */
const CONFIRM_REMOVED_BUDGET_MS = 6000

async function confirmRemoved(
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  removed: string
): Promise<void> {
  // `sameEntry` matches in both directions, which is right for pairing a recall
  // against a caption but wrong here: deleting "ok do it" while "ok do it now,
  // carefully" is still queued would report a failed delete that in fact
  // succeeded, and leave the sheet stuck (2026-09-14 review). The drawn row is a
  // shortened form of the removed message, never the other way round.
  const deadline = Date.now() + CONFIRM_REMOVED_BUDGET_MS
  for (let attempt = 0; attempt < 6 && Date.now() < deadline; attempt += 1) {
    await io.pause()
    const screen = await io.read()
    checkScreen(agent, screen, 'uncertain')
    if (!queueFromScreen(agent, screen).some((entry) => queueRowIsPendingSend(removed, entry))) {
      return
    }
  }
  throw new Error('That message is still queued on the agent. It has not been deleted.')
}

/** Raised when the messages of a recalled queue cannot be put back: part of a rebuild reached the
 * agent (retrying would queue the landed ones a second time), or the rebuild was refused before
 * any write because a queued message starts with `!` (retyping it would run it again). Either way
 * the editor must stop offering to write and let the user read what is left. */
export class QueueRebuildError extends Error {
  readonly remaining: string[]
  constructor(message: string, remaining: string[]) {
    super(message)
    this.name = 'QueueRebuildError'
    this.remaining = remaining
  }
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
  // Every part is retyped into the emptied input and submitted, so any that starts with `!`
  // would run as a shell command. Refused before the clear. Claude Code 2.1.287 can queue a
  // shell command (its queue entries carry a `mode`), so an unedited part may start with one
  // too: retyping it would run it AGAIN, and the same refusal could never succeed, so the
  // messages stay where they are, stranded, and the message says so. A `!` the user just typed
  // into the edited message is theirs to fix, and is refused plainly.
  if (text !== edit.text && shellCommandOfSend(text, 'claude') !== null) {
    throw new Error(SHELL_COMMAND_QUEUE_REFUSAL)
  }
  if (parts.some((part) => shellCommandOfSend(part, 'claude') !== null)) {
    throw new QueueRebuildError(SHELL_COMMAND_QUEUE_REBUILD_REFUSAL, parts)
  }
  if (edit.segments!.some(opaque)) {
    throw new Error(
      'A queued message holds an attachment or collapsed paste that Orca cannot retype.'
    )
  }
  // One budget for the whole save. Per-call deadlines multiply: a six-message
  // queue could sit for over a minute with every control disabled.
  const deadline = Date.now() + Math.min(15_000 + parts.length * 8_000, 60_000)
  const sent: string[] = []
  try {
    await clearInput(io, 'claude', edit.draft, onReplaced, deadline)
    for (const part of parts) {
      // Counted with the same comparator the confirmation uses, or two parts
      // that differ only in whitespace look distinct here and identical there.
      const expected = sent.filter((done) => sameText(done, part)).length + 1
      await typeAndSubmit(io, 'claude', part, expected, deadline)
      sent.push(part)
      onReplaced?.('')
    }
  } catch (cause) {
    // Everything from the first kill key on is destructive: the recall already
    // emptied the queue into the composer and the composer is being cleared.
    // A failure here cannot claim the input was kept, and it must strand, or
    // the editor offers a Save that re-queues whatever did land.
    const left = [...parts]
    for (const done of sent) {
      const at = left.indexOf(done)
      if (at !== -1) {
        left.splice(at, 1)
      }
    }
    const why =
      cause instanceof Error
        ? cause.message
            .replace(
              /\s*(?:Your input has been kept|The agent input has been preserved|It has not been submitted|The message is in the agent input, unsent)\.?/gi,
              ''
            )
            .trim()
        : ''
    // A message the agent may have taken as a live prompt cannot also be
    // declared absent from the agent. Saying both in one breath left the user
    // with nothing to act on, so the uncertain case only reports what left the
    // queue and lets its own sentence carry the doubt.
    const maybeDelivered = cause instanceof QueueMaybeDeliveredError
    const fate = maybeDelivered
      ? 'left the queue'
      : `left the queue and ${left.length === 1 ? 'is' : 'are'} not on the agent`
    throw new QueueRebuildError(
      `${why ? `${why} ` : ''}${left.length} message${left.length === 1 ? '' : 's'} ${fate}. ` +
        `Copy ${left.length === 1 ? 'it' : 'them'} before closing: ` +
        left.map((item) => JSON.stringify(item)).join(', '),
      left
    )
  }
}
