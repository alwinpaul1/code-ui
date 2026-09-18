import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'

/** One terminal from `terminal.list`, reduced to what a prompt lookup needs.
 *  `agent` is the host's `agentIdentity` (a `TuiAgent` name such as 'claude' or
 *  'codex'), or null when the host names none. */
export type PermissionLookupTerminal = { handle: string; agent: string | null }

function readString(source: object, key: string): string | null {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Read `terminal.list` down to handles.
 *
 * Reads rather than asserts, because a host older or newer than this build is
 * exactly what an assertion would wave through — and this runs to decorate a
 * notification, where being wrong is worse than being absent.
 */
const terminalsReader: RpcCompatibleReader<unknown, 'terminals', PermissionLookupTerminal[]> = (
  raw
) => {
  const box = raw == null ? {} : Object(raw)
  const listed: unknown = Reflect.get(box, 'terminals')
  const value: PermissionLookupTerminal[] = Array.isArray(listed)
    ? listed.flatMap((entry) => {
        if (entry == null || typeof entry !== 'object') {
          return []
        }
        const handle = readString(Object(entry), 'handle')
        if (handle === null) {
          return []
        }
        // `agentIdentity` is the host naming an agent in this PTY. A terminal
        // without one cannot be the thing a prompt is waiting in, and WHICH
        // agent decides the keystrokes an answer needs.
        return [{ handle, agent: readString(Object(entry), 'agentIdentity') }]
      })
    : []
  return { compatible: true, variant: 'terminals', value, salvage: { droppedPaths: [], droppedCount: 0 } }
}

/** The agent's live `interactivePrompt`: the approval envelope for a
 *  permission, or the question tool's raw input for a question. */
const promptReader: RpcCompatibleReader<unknown, 'interactive-prompt', string | null> = (raw) => {
  const box = raw == null ? {} : Object(raw)
  const status: unknown = Reflect.get(box, 'agentStatus')
  const prompt = status != null && typeof status === 'object'
    ? Reflect.get(Object(status), 'interactivePrompt')
    : undefined
  return {
    compatible: true,
    variant: 'interactive-prompt',
    value: typeof prompt === 'string' && prompt.length > 0 ? prompt : null,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

/** A null verdict means the host refused or could not answer; the caller then
 *  keeps the desktop's own notification rather than guessing at one. */
export const permissionTerminalList = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.list-for-permission',
    method: 'terminal.list',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: terminalsReader
  })
)

export const permissionAgentStatus = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.agent-status-for-permission',
    method: 'terminal.agentStatus',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: promptReader
  })
)
