import { AGENT_TUI_CLEAR_INPUT_LINE } from '../../../src/shared/agent-tui-input-clear'
import {
  buildTerminalLiveMirrorPayload,
  computeTerminalLiveMirrorStep
} from '../terminal/terminal-live-preedit-mirror'

export type NativeChatDraftMirrorPlan = {
  /** Ordered PTY writes, each its own `terminal.send`. Empty when nothing changed. */
  readonly writes: readonly string[]
  /** What the TUI input line holds once every write has landed. */
  readonly nextSentText: string
}

/**
 * The single line the chat draft occupies on the agent's TUI input.
 *
 * Why one line: the send path clears the line with one Ctrl+U before typing the
 * real body, so the mirror must never occupy more than that clear removes. A
 * newline is also a submit on a raw PTY. Multi-line drafts therefore mirror
 * flattened; the real body still goes out with its newlines intact at send.
 */
export function nativeChatDraftMirrorLine(draft: string): string {
  return draft.replace(/\r\n|\r|\n/g, ' ')
}

/**
 * PTY writes that turn the mirrored line from `sentText` into `draft`.
 *
 * A fresh line (nothing mirrored yet) is cleared first as a separate write: the
 * TUI line may hold residue from a previous visit, or text typed on the desktop
 * itself, and the phone draft is taking the line over. Erase + append deltas ride
 * the same mirror diff the live terminal input uses, so a correction costs DELs
 * for the changed suffix only.
 */
export function planNativeChatDraftMirror(
  sentText: string,
  draft: string
): NativeChatDraftMirrorPlan {
  const line = nativeChatDraftMirrorLine(draft)
  if (line === sentText) {
    return { writes: [], nextSentText: sentText }
  }
  const step = computeTerminalLiveMirrorStep(sentText, line, { commitHeld: true })
  const payload = buildTerminalLiveMirrorPayload(step)
  const writes: string[] = []
  if (sentText.length === 0 && line.length > 0) {
    writes.push(AGENT_TUI_CLEAR_INPUT_LINE)
  }
  if (payload.length > 0) {
    writes.push(payload)
  }
  return { writes, nextSentText: step.nextSentText }
}
