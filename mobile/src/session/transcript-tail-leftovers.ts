import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'

/**
 * Close a "Code UI · transcript" terminal a build of 2026-09-19 left on the
 * desktop. Those builds tailed the session transcript through a host
 * terminal; the app being killed mid-chat (an install over adb, a swipe
 * away) left the `tail -F` tab standing. The feature is gone — the tab
 * status carries the prompts now (agent-status-prompts.ts) — and this is
 * the only trace of it: a title match, closed on sight, once per listing.
 * A user's own terminal never carries this title.
 */
export const TRANSCRIPT_TAIL_LEFTOVER_TITLE = 'Code UI · transcript'

export function isTranscriptTailLeftover(terminal: { title?: string | null; connected?: boolean }): boolean {
  return terminal.title?.trim() === TRANSCRIPT_TAIL_LEFTOVER_TITLE && terminal.connected === true
}

const closedReader: RpcCompatibleReader<unknown, 'transcript-tail-leftover-closed', true> = () => ({
  compatible: true,
  variant: 'transcript-tail-leftover-closed',
  value: true,
  salvage: { droppedPaths: [], droppedCount: 0 }
})

/** closeTab, not close: `terminal.close` kills one pane and leaves the tab
 *  standing on the desktop (this fork's own note, 2026-09-14). */
const leftoverClose = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'transcript-tail-leftover.terminal-close',
    method: 'terminal.closeTab',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: closedReader
  })
)

type LeftoverSender = Parameters<typeof leftoverClose.request>[0]

const closing = new Set<string>()

/** Close every leftover in a listing; best effort, once per handle at a time. */
export function closeTranscriptTailLeftovers(
  client: LeftoverSender,
  terminals: readonly { handle: string; title?: string | null; connected?: boolean }[]
): void {
  for (const terminal of terminals) {
    if (!isTranscriptTailLeftover(terminal) || closing.has(terminal.handle)) {
      continue
    }
    closing.add(terminal.handle)
    void leftoverClose
      .request(client, { terminal: terminal.handle })
      .catch(() => undefined)
      .finally(() => closing.delete(terminal.handle))
  }
}
