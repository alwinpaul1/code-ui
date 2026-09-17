import type { RpcClient } from '../transport/rpc-client'
import { pushRegister } from './push-registration-operations'
import { acquirePushToken } from './push-token'
import type { MobilePushFilter } from '../../../src/shared/mobile-push-contract'

/**
 * What the desktop said about this device's push token.
 *
 * The `reason` strings the desktop can return are the contract's own
 * (`MobilePushRegisterResult`); the three added here name failures that happen
 * before the desktop is ever asked, so a caller has one thing to read rather
 * than a result, a throw and a silence.
 */
export type PushRegistrationOutcome =
  | { registered: true; registrationId: string }
  | { registered: false; reason: string; detail?: string }

/**
 * Register this device's push token with a host.
 *
 * Worth knowing before reading a rejection as a bug: on a stock Orca desktop
 * this hands the token to the push gateway Orca was built against. FCM tokens
 * are scoped to the project that minted them, so a token from this fork's own
 * Firebase project is not routable by that gateway and `gateway_rejected` is the
 * correct answer, not a defect. It becomes useful the day the desktop points at
 * a gateway holding this fork's credentials.
 */
export async function registerPushForHost(
  client: RpcClient,
  filter: MobilePushFilter = {}
): Promise<PushRegistrationOutcome> {
  if (client.getState() !== 'connected') {
    return { registered: false, reason: 'offline' }
  }
  const token = await acquirePushToken()
  if (!token.ok) {
    // Why fold the token reason into the detail: the caller shows one line, and
    // "no push token" without "add google-services.json" sends the reader
    // looking at the desktop for a problem on the phone.
    return {
      registered: false,
      reason: 'no-push-token',
      detail: token.detail ? `${token.reason}: ${token.detail}` : token.reason
    }
  }
  try {
    const reply = pushRegister.interpret(
      await pushRegister.request(client, {
        platform: token.platform,
        token: token.token,
        filter
      })
    )
    // Null is the transport or the desktop refusing the call itself, which is a
    // different problem from the gateway refusing the token and has to read that
    // way — one is worth retrying, the other never will be.
    return reply ?? { registered: false, reason: 'request_failed' }
  } catch (error) {
    return {
      registered: false,
      reason: 'request_failed',
      detail: error instanceof Error ? error.message : 'unknown error'
    }
  }
}
