import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc-operation'
import type { RpcCompatibleReader } from '../../transport/rpc-operation-contract'

const NOTHING_DROPPED = { droppedPaths: [], droppedCount: 0 } as const

export type TranscriptTailTerminal = { handle: string; tabId: string | null }

/** `terminal.create` answers `{ terminal: { handle, tabId, … } }`; the handle is
 *  what every later read and the close are keyed by. */
const createdTerminalReader: RpcCompatibleReader<
  unknown,
  'transcript-tail-terminal',
  TranscriptTailTerminal | null
> = (raw) => {
  const terminal = raw == null ? undefined : Reflect.get(Object(raw), 'terminal')
  const handle = terminal == null ? undefined : Reflect.get(Object(terminal), 'handle')
  const tabId = terminal == null ? undefined : Reflect.get(Object(terminal), 'tabId')
  return {
    compatible: true,
    variant: 'transcript-tail-terminal',
    value:
      typeof handle === 'string' && handle
        ? { handle, tabId: typeof tabId === 'string' ? tabId : null }
        : null,
    salvage: NOTHING_DROPPED
  }
}

export const transcriptTailTerminalCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'transcript-tail.terminal-create',
    method: 'terminal.create',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: createdTerminalReader
  })
)

export type TranscriptTailRead = {
  rows: string[]
  /** Where the next read continues from. */
  nextCursor: number | null
  /** The oldest row the runtime still holds; above the cursor asked for,
   *  rows were dropped between reads. */
  oldestCursor: number | null
  source: string | null
}

function cursorOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10)
  }
  return null
}

/** A stream read: `{ terminal: { tail: string[], nextCursor, oldestCursor, source } }`. */
const streamReadReader: RpcCompatibleReader<unknown, 'transcript-tail-read', TranscriptTailRead> = (
  raw
) => {
  const terminal = raw == null ? undefined : Reflect.get(Object(raw), 'terminal')
  const boxed = terminal == null ? {} : Object(terminal)
  const tail = Reflect.get(boxed, 'tail')
  const source = Reflect.get(boxed, 'source')
  return {
    compatible: true,
    variant: 'transcript-tail-read',
    value: {
      rows: Array.isArray(tail) ? tail.filter((row): row is string => typeof row === 'string') : [],
      nextCursor: cursorOf(Reflect.get(boxed, 'nextCursor')),
      oldestCursor: cursorOf(Reflect.get(boxed, 'oldestCursor')),
      source: typeof source === 'string' ? source : null
    },
    salvage: NOTHING_DROPPED
  }
}

export const transcriptTailTerminalRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'transcript-tail.terminal-read',
    method: 'terminal.read',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: streamReadReader
  })
)

const closedReader: RpcCompatibleReader<unknown, 'transcript-tail-closed', true> = () => ({
  compatible: true,
  variant: 'transcript-tail-closed',
  value: true,
  salvage: NOTHING_DROPPED
})

/** closeTab, not close: `terminal.close` kills one pane and leaves the tab
 *  standing on the desktop (this fork's own note, 2026-09-14). */
export const transcriptTailTerminalClose = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'transcript-tail.terminal-close',
    method: 'terminal.closeTab',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: closedReader
  })
)

/** What the tail sends with, named from an operation so no module names the raw port. */
export type TranscriptTailSender = Parameters<typeof transcriptTailTerminalRead.request>[0]

/** `terminal.rename`, to put the tail's title back after the host adopts
 *  the terminal into its strip under a default name. */
export const transcriptTailTerminalRename = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'transcript-tail.terminal-rename',
    method: 'terminal.rename',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: closedReader
  })
)
