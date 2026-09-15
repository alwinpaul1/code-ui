/**
 * What the Notifications screen should say about Android power management.
 *
 * Why: with "Deliver while the app is closed" on, the foreground service keeps
 * the runtime alive, but Doze still suspends the app's network and ignores its
 * wake locks unless the app is exempt from battery optimisation. The link then
 * goes silent while the phone sits idle and everything arrives at the next
 * screen-on or maintenance window — "notifications come when I open the app".
 * Only the exemption fixes that, and only the user can grant it.
 */
export type BackgroundDeliveryPowerState = {
  /** Background delivery is on and running. */
  deliveryOn: boolean
  /** Android reports the app exempt from battery optimisation ("Unrestricted"). */
  unrestricted: boolean
  /** Whether this install has already been asked on open. Absent on the
   *  switch-on path, which asks regardless. */
  askedOnOpen?: boolean
}

export type BackgroundDeliveryPowerAdvice = {
  /** Show the "Allow unrestricted battery use" row. */
  showRow: boolean
  /** Open the system exemption prompt as part of switching delivery on. */
  promptOnEnable: boolean
  /** Ask once when the app OPENS with delivery already on and no exemption.
   *
   *  Without this, someone who already had notifications on and merely updated
   *  the app was never asked: the prompt hung off switching delivery on, and
   *  they never switch anything. The settings row was the only other surface
   *  and is only seen by someone who goes looking, so they got slow
   *  notifications indefinitely with nothing saying why (2026-09-15).
   *
   *  Once per install, not every launch — a dialog that reappears forever is
   *  one people learn to dismiss without reading. The row stays either way. */
  promptOnOpen: boolean
  caption: string
}

export const UNRESTRICTED_BATTERY_CAPTION =
  'Android pauses background connections to save power, so notifications can wait until you open the app. Allow unrestricted battery use to keep them instant.'

export function adviseBackgroundDeliveryPower(
  state: BackgroundDeliveryPowerState
): BackgroundDeliveryPowerAdvice {
  const needsExemption = state.deliveryOn && !state.unrestricted
  return {
    showRow: needsExemption,
    promptOnEnable: !state.unrestricted,
    promptOnOpen: needsExemption && state.askedOnOpen !== true,
    caption: needsExemption ? UNRESTRICTED_BATTERY_CAPTION : ''
  }
}
