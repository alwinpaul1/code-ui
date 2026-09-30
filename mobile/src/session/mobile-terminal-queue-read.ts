import { codexQueueReadFromScreen } from './codex-terminal-queued-messages'
import { terminalDialogKind } from './mobile-native-chat-dialog-guard'
import { claudeQueueViewFromScreen } from './mobile-terminal-queued-messages'

/** The agent's queue box as one screen read found it. */
export type QueueBoxRead = {
  entries: string[]
  /** Whether the read could see the box: false means unknown, not empty. */
  readable: boolean
}

const UNREAD: QueueBoxRead = { entries: [], readable: false }

/**
 * The queue box on one screen read, and whether that read could see it.
 *
 * An empty reading was taken for an empty box, and the queue-box witness
 * (use-absorbed-queue-echoes.ts) took every message the box had listed for
 * one the agent took. When the box listed it again after a streaming row had
 * landed, the message was drawn beside its own queue entry (review of
 * 2026-09-30). These reads cannot see the box:
 *
 * - Claude Code with an entry selected at the desk (the rows are ambiguous
 *   then), with its hint on the input row and a block the reader refuses, or
 *   with no hint and no input row (claudeQueueViewFromScreen);
 * - Codex with no `›` row on screen (codexQueueReadFromScreen);
 * - either agent under a dialog that takes keys, which Claude draws and
 *   Codex draws in the composer's place (terminalDialogKind; Codex's
 *   approval marks its selected option with the composer's own `› `);
 * - an agent whose box the phone does not read.
 *
 * A reading that lists messages is always a reading. What may still read as
 * an empty box without being one: Claude's queue hint is its composer's
 * placeholder, so a draft typed at the desk may hide it, and no capture of
 * that screen exists to tell it by.
 */
export function queueBoxReadFromScreen(lines: readonly string[], agent: string | null | undefined, draft?: unknown): QueueBoxRead {
  const read =
    agent === 'codex'
      ? codexQueueReadFromScreen(lines)
      : agent === 'claude' || agent === 'openclaude'
        ? claudeQueueViewFromScreen(lines, draft)
        : null
  if (read === null) {
    return UNREAD
  }
  return {
    entries: read.entries,
    readable: read.entries.length > 0 || (read.readable && terminalDialogKind(lines, agent) === null)
  }
}
