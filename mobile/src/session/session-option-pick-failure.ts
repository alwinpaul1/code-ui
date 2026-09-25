// The seam a session-option pick says its own failure through.
//
// The picker is a BottomDrawer, which draws in its own native window, and the
// chat's send-failure banner and toast draw in the screen under it. A pick that
// failed kept the drawer open and said why only there, so the user saw a row
// that did nothing (2026-09-25). The drawer now hands each pick a reporter, and
// every lane that can refuse a pick says its reason through it.
import type { CatalogCommandDelivery } from '../../../src/shared/agent-session-option-catalog'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'

/** Where a pick's own failure is said. The open drawer hands one in; without one
 *  (a typed `/model`, which has no drawer) the lane says it on the chat's
 *  banner or toast, as before. */
export type PickFailureReport = (message: string) => void

export type PickDispatchOptions = {
  delivery?: CatalogCommandDelivery
  onError?: PickFailureReport
}

export type PickDispatch = (
  command: string,
  options?: PickDispatchOptions
) => Promise<MobileNativeChatSendOutcome>

/** A pick's command dispatch, carrying only the options it has. With none it is
 *  made exactly as before, with no options argument at all. */
export function dispatchPick(
  dispatch: PickDispatch,
  command: string,
  { delivery, onError }: PickDispatchOptions
): Promise<MobileNativeChatSendOutcome> {
  if (!delivery && !onError) {
    return dispatch(command)
  }
  return dispatch(command, { ...(delivery ? { delivery } : {}), ...(onError ? { onError } : {}) })
}
