import type { RpcResponse } from './types'

/**
 * The refusal Orca's WebSocket dispatch sends when a mobile-scope device token
 * asks for a method outside its hardcoded allowlist (the `iRa` Set in the
 * 1.4.205 bundle, checked as `u.scope === 'mobile' && !iRa.has(s.method)`
 * before dispatch). Pure, so a sender that only needs to recognise the
 * refusal — the `/` menu's skills read — can do so without pulling in the
 * probe hook and its React Native chain; the probe itself lives in
 * host-mobile-capabilities.ts.
 */

/** The gate's message, verbatim from the 1.4.205 bundle. The code alone is not
 *  enough: the host also answers `forbidden` for a client-hosted browser page
 *  without a paired runtime, which is not this gate. */
const MOBILE_SCOPE_REFUSAL_MESSAGE = /is not available to mobile clients/

/** The mobile-scope dispatch gate's refusal, and only that. */
export function isMobileScopeRefusal(response: RpcResponse): boolean {
  return (
    !response.ok &&
    response.error.code === 'forbidden' &&
    MOBILE_SCOPE_REFUSAL_MESSAGE.test(response.error.message)
  )
}
