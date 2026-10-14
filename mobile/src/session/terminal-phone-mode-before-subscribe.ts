/**
 * Phone mode is asked for before a drawn terminal is subscribed, once per visit.
 *
 * Leaving a terminal hands it back to the desk with `terminal.setDisplayMode`
 * 'desktop' (use-mobile-session-view-switch.ts). The host keeps that mode for
 * the PTY until it is told 'auto', and a subscribe in 'desktop' mode is a
 * passive watch: no phone fit, a desktop-width snapshot. The view switch asks
 * for 'auto' from an effect, after the render, so the subscribe used to go out
 * first and every terminal the phone had left reopened at desktop width and
 * then reflowed (2026-10-14: "all terminals in flashes and changes to mobile").
 *
 * So the first drawn subscribe of a visit waits for the claim. A covered
 * (chat) subscribe never claims: chat does not draw the terminal, and the desk
 * keeps its width under it. "Claimed" lasts until the phone hands the terminal
 * back (the view switch deletes it then), so a re-subscribe inside the visit
 * sends no second claim and a manual Desktop pick survives the fit pass.
 */

/** Longest a subscribe waits for the host to accept phone mode. A backstop for
 *  a host that never answers; the cover's own backstop is 2.5 s. */
export const PHONE_MODE_BEFORE_SUBSCRIBE_TIMEOUT_MS = 1500

/** Handles whose settled claim is resuming its subscribe, per screen's claim set. */
const passingByClaimSet = new WeakMap<Set<string>, Set<string>>()

export type PhoneModeClaim = (handle: string) => Promise<boolean>

type ClaimVerdict = 'accepted' | 'refused' | 'failed' | 'timeout'

function settleClaim(claim: PhoneModeClaim, handle: string): Promise<ClaimVerdict> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), PHONE_MODE_BEFORE_SUBSCRIBE_TIMEOUT_MS)
    claim(handle).then(
      (accepted) => {
        clearTimeout(timer)
        resolve(accepted ? 'accepted' : 'refused')
      },
      () => {
        clearTimeout(timer)
        resolve('failed')
      }
    )
  })
}

/**
 * Returns true when the subscribe was deferred behind a phone-mode claim; the
 * caller must then return, and `resume` subscribes once the claim settles.
 * The handle sits in `subscribingHandlesRef` meanwhile, so a second subscribe
 * is skipped as in flight, and an unsubscribe in between (the user left) bumps
 * its seq and drops it, so a terminal no longer shown is never phone-fitted.
 * A scope without the refs (a test mounting the subscription alone) subscribes
 * at once, as before.
 */
export function deferSubscribeUntilPhoneMode(
  handle: string,
  refs: {
    phoneModeClaimRef?: { current: PhoneModeClaim | null }
    phoneModeClaimedHandlesRef?: { current: Set<string> }
    subscribingHandlesRef: { current: Set<string> }
    subscribeSeqRef: { current: Map<string, number> }
  },
  resume: () => void
): boolean {
  const claim = refs.phoneModeClaimRef?.current
  const claimedHandles = refs.phoneModeClaimedHandlesRef?.current
  if (!claim || !claimedHandles || claimedHandles.has(handle)) {
    return false
  }
  // The resumed subscribe of a settled claim passes once, even when a hand-back
  // unmarked the handle meanwhile; otherwise it would claim again in a loop.
  const passing = passingByClaimSet.get(claimedHandles)
  if (passing?.delete(handle)) {
    return false
  }
  const subscribing = refs.subscribingHandlesRef.current
  const seqs = refs.subscribeSeqRef.current
  subscribing.add(handle)
  // Marked before the claim goes out, so a hand-back while it is out (HOME
  // inside one round trip) deletes the mark and nothing puts it back: the host
  // ends in desktop mode, and the next visit must ask again. Claimed even when
  // refused: the subscribe goes out anyway (an unconfirmed mode beats a blank
  // pane), and the view switch keeps retrying the claim.
  claimedHandles.add(handle)
  const token = seqs.get(handle) ?? 0
  void settleClaim(claim, handle).then((verdict) => {
    if (!subscribing.has(handle) || (seqs.get(handle) ?? 0) !== token) {
      // The visit ended with no subscribe; whatever the host holds, ask again next time.
      claimedHandles.delete(handle)
      console.log('[fit][session] phone mode claim outlived its visit; no subscribe', {
        handle: handle.slice(-8),
        verdict
      })
      return
    }
    subscribing.delete(handle)
    const pass = passingByClaimSet.get(claimedHandles) ?? new Set<string>()
    passingByClaimSet.set(claimedHandles, pass)
    pass.add(handle)
    if (verdict !== 'accepted') {
      console.log('[fit][session] phone mode not confirmed before subscribe; frame may be desktop-width', {
        handle: handle.slice(-8),
        verdict
      })
    }
    resume()
    pass.delete(handle)
  })
  return true
}
