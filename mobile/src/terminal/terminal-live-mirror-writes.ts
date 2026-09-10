import { AGENT_TUI_MAX_KEY_WRITE_BYTES } from '../session/agent-tui-clear-write-chunks'
import { TERMINAL_DEL_BYTE, type TerminalLiveMirrorStep } from './terminal-live-preedit-mirror'

/**
 * A mirror step as writes the agent will read as KEYS, not as pasted text.
 *
 * An erase is a run of DEL bytes, and an agent reads a long enough chunk as a
 * paste — measured at 64 bytes against a live Claude Code 2.1.266 (see
 * `AGENT_TUI_MAX_KEY_WRITE_BYTES`). Past that the deletes are inserted rather
 * than applied, and the draft the agent holds silently stops matching the
 * phone's.
 *
 * The appended text stays whole: text read as a paste is exactly what we want,
 * and splitting it would turn one paste into several.
 */
export function buildTerminalLiveMirrorWrites(
  step: Pick<TerminalLiveMirrorStep, 'eraseCount' | 'appendText'>
): string[] {
  const erase = TERMINAL_DEL_BYTE.repeat(Math.max(0, step.eraseCount))
  const writes: string[] = []
  if (erase.length + step.appendText.length < AGENT_TUI_MAX_KEY_WRITE_BYTES) {
    // The common edit: one round trip, exactly as before.
    if (erase.length > 0 || step.appendText.length > 0) {
      writes.push(erase + step.appendText)
    }
    return writes
  }
  const size = AGENT_TUI_MAX_KEY_WRITE_BYTES - 1
  for (let start = 0; start < erase.length; start += size) {
    writes.push(erase.slice(start, start + size))
  }
  if (step.appendText.length > 0) {
    writes.push(step.appendText)
  }
  return writes
}
