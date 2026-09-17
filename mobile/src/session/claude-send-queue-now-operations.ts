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
export const sendQueueNowWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.send-queue-now',
    method: 'terminal.send',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: acceptedReader
  })
)
