// Both agents' queue boxes holding given entries, read the way the chat's
// controller reads them (queueBoxReadFromScreen, through the HUD observation,
// into `nativeChatQueuedMessages`), for tests that feed the chat that field.
import { NAMED_RULES, QUEUED_ROW_TEXT, queuedScreen2_1_285 } from './fixtures/claude-queued-named-rule-2.1.285'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'

/** The entries a read that saw the box found; a fixture the reader cannot
 *  see through is a broken fixture, not an empty box. */
function readBox(lines: readonly string[], agent: 'claude' | 'codex'): string[] {
  const read = queueBoxReadFromScreen(lines, agent)
  if (!read.readable) {
    throw new Error(`the ${agent} queue box fixture is not readable`)
  }
  return read.entries
}

/** Claude Code's queue block as the 2.1.285 capture has it
 *  (fixtures/claude-queued-named-rule-2.1.285.ts; 2.1.286 keeps every string
 *  the readers match, docs/mobile-queue-controls.md), holding one-line
 *  `entries`. None is the screen with no queue: no rows, no send-now row, and
 *  the composer's bare `❯` in place of its queue placeholder (the fixture's
 *  taken screen). */
export function claudeQueueBox(entries: readonly string[]): string[] {
  const screen = queuedScreen2_1_285(NAMED_RULES.captured1152).flatMap((line) => {
    if (line === `❯ ${QUEUED_ROW_TEXT}`) {
      return entries.map((entry) => `❯ ${entry}`)
    }
    if (entries.length > 0) {
      return [line]
    }
    if (line === '  ctrl+enter to send now') {
      return []
    }
    return [line === '❯ Press up to edit queued messages' ? '❯' : line]
  })
  return readBox(screen, 'claude')
}

/** Codex's pending-input preview (openai/codex,
 *  bottom_pane/pending_input_preview.rs; codex-terminal-queued-messages.test.ts)
 *  holding one-line `entries`, over its composer. */
export function codexQueueBox(entries: readonly string[]): string[] {
  return readBox(
    entries.length === 0
      ? ['› ']
      : ['• Queued follow-up inputs', ...entries.map((entry) => `  ↳ ${entry}`), '    alt + ↑ edit last queued message', '› '],
    'codex'
  )
}
