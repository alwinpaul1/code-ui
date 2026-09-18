import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'

/** Read `terminal.send`'s reply down to whether the host accepted the write. */
const acceptedReader: RpcCompatibleReader<unknown, 'send-accepted', boolean> = (raw) => {
  const box = raw == null ? {} : Object(raw)
  const send: unknown = Reflect.get(box, 'send')
  const accepted = send != null && typeof send === 'object' ? Reflect.get(Object(send), 'accepted') : undefined
  return {
    compatible: true,
    variant: 'send-accepted',
    value: accepted === true,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

/** Null is the transport refusing the call; false is the host declining the write. */
export const planFeedbackWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.send-claude-plan-feedback',
    method: 'terminal.send',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: acceptedReader
  })
)

export type ClaudePlanFeedbackScreen = {
  readonly lines: readonly string[]
  /** False for the stream-fallback shape a legacy host answers with instead
   *  of the current frame; that reply carries scrollback, not the live
   *  highlight this verification needs. */
  readonly isScreen: boolean
}

/** Read `terminal.read`'s reply down to the current screen frame, the same
 *  fields use-mobile-terminal-hud-observation.ts already reads inline. */
const screenReader: RpcCompatibleReader<unknown, 'terminal-screen', ClaudePlanFeedbackScreen> = (
  raw
) => {
  const box = raw == null ? {} : Object(raw)
  const terminal: unknown = Reflect.get(box, 'terminal')
  const terminalBox = terminal != null && typeof terminal === 'object' ? Object(terminal) : {}
  const source: unknown = Reflect.get(terminalBox, 'source')
  const tail: unknown = Reflect.get(terminalBox, 'tail')
  const lines: unknown = Reflect.get(terminalBox, 'lines')
  const raw2 = Array.isArray(tail) ? tail : Array.isArray(lines) ? lines : []
  return {
    compatible: true,
    variant: 'terminal-screen',
    value: {
      lines: raw2.filter((line): line is string => typeof line === 'string'),
      isScreen: source === 'screen'
    },
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

/** Null is the transport refusing the call. */
export const planFeedbackScreenRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.read-claude-plan-feedback-screen',
    method: 'terminal.read',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: screenReader
  })
)
