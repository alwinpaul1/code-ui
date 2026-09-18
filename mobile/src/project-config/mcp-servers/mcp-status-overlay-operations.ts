import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc-operation'
import { rpcUncheckedPayloadReader } from '../../transport/rpc-reader-payload'
import type { RpcCompatibleReader } from '../../transport/rpc-operation-contract'

/** Read `terminal.send`'s reply down to whether the host accepted the write.
 *  Identical shape to claude-fork-session-operations.ts's `forkSessionWrite`
 *  — kept as its own operation, not a shared import, because the two
 *  features (fork, MCP status) have no reason to change together. */
const acceptedReader: RpcCompatibleReader<unknown, 'send-accepted', boolean> = (raw) => {
  const box = raw == null ? {} : Object(raw)
  const send: unknown = Reflect.get(box, 'send')
  const accepted =
    send != null && typeof send === 'object' ? Reflect.get(Object(send), 'accepted') : undefined
  return {
    compatible: true,
    variant: 'send-accepted',
    value: accepted === true,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

export const mcpStatusOverlayWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.send-mcp-status',
    method: 'terminal.send',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: acceptedReader
  })
)

/** The one-shot, best-effort lookup behind the "Show status in terminal"
 *  button — see mcp-status-terminal-lookup.ts for how its reply is read. */
export const mcpStatusSessionTabsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'session.tabs.list-for-mcp-status',
    method: 'session.tabs.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('mcp-status-session-tabs')
  })
)
