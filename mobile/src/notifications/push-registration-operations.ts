import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'

/** What the desktop answered, once it has been read into a shape this app can use. */
export type PushRegisterReply =
  | { registered: true; registrationId: string }
  | { registered: false; reason: string }

/**
 * Read `notifications.registerPush`'s reply.
 *
 * Why an answer it cannot read becomes `{registered: false}` rather than a
 * success: believing push is registered when nothing is routed is the one
 * failure with no symptom. The app would stop showing the reason, the user would
 * stop looking, and no notification would ever arrive.
 */
const registerReader: RpcCompatibleReader<unknown, 'push-registration', PushRegisterReply> = (
  raw
) => {
  // Read the fields rather than assert a shape: a reply from a desktop this
  // build has never seen is exactly what an assertion would wave through.
  const reply = raw == null ? {} : Object(raw)
  const registered: unknown = Reflect.get(reply, 'registered')
  const registrationId: unknown = Reflect.get(reply, 'registrationId')
  const reason: unknown = Reflect.get(reply, 'reason')
  const value: PushRegisterReply =
    registered === true && typeof registrationId === 'string'
      ? { registered: true, registrationId }
      : {
          registered: false,
          reason: typeof reason === 'string' ? reason : 'unreadable response'
        }
  return {
    compatible: true,
    variant: 'push-registration',
    value,
    salvage: { droppedPaths: [], droppedCount: 0 }
  }
}

/** A null verdict is the transport refusing, which is not the same as the gateway refusing. */
export const pushRegister = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'notifications.register-push',
    method: 'notifications.registerPush',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: registerReader
  })
)
