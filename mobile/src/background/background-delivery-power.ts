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
}

export type BackgroundDeliveryPowerAdvice = {
  /** Show the "Allow unrestricted battery use" row. */
  showRow: boolean
  /** Open the system exemption prompt as part of switching delivery on. */
  promptOnEnable: boolean
  /** Open Android's exemption dialog when the app OPENS with delivery on and no exemption.
   *
   *  Every launch, until it is granted (2026-10-16, asked by the user: "Make this work
   *  automatically by default"). Android lets no app exempt itself, so its one-tap dialog is the
   *  nearest thing. It was once per fortnight behind a sheet of the app's own, after every release
   *  had asked again (2026-09-17); a declined ask then left Doze cutting the relay whenever the
   *  phone idled, and every reopen dialled again. The row stays either way. */
  promptOnOpen: boolean
  caption: string
}

/**
 * What the app says immediately before Android's own dialog.
 *
 * Android asks "Allow Code UI to always run in the background? This may use more
 * battery." That names the cost and not the benefit, so it is declined
 * reflexively — and then notifications are late and nothing connects the two.
 *
 * So: lead with what the reader gets, name the cost plainly rather than hiding
 * it, and leave a way out that is not a dead end. The settings row keeps the
 * offer open for anyone who says not now.
 */
export const BACKGROUND_POWER_PROMPT = {
  title: 'Keep notifications on time',
  body: 'Android pauses background connections to save power, so notifications wait until you open the app. Unrestricted battery use keeps the connection alive. It costs a little battery, and you can turn it off in Settings.',
  confirm: 'Allow',
  dismiss: 'Not now'
} as const

/**
 * Shown when the reader came back from Android's screen and the exemption still
 * is not granted.
 *
 * It names what went wrong rather than repeating the original ask, because
 * repeating it reads as the app not having noticed. The likely cause is
 * specific and worth saying: the system opens a LIST on many builds, and the
 * app has to be found in it and switched — which is not what "Allow" implies.
 */
export const BACKGROUND_POWER_NOT_TAKEN_PROMPT = {
  title: "That didn't go through",
  body: 'Android still has Code UI on battery optimisation. It often opens a list rather than a switch, so the app has to be found in it and set to Unrestricted. Try again, or do it later from Settings.',
  confirm: 'Try again',
  dismiss: 'Later'
} as const

export const UNRESTRICTED_BATTERY_CAPTION =
  'Android pauses background connections to save power, so notifications can wait until you open the app. Allow unrestricted battery use to keep them instant.'

export function adviseBackgroundDeliveryPower(
  state: BackgroundDeliveryPowerState
): BackgroundDeliveryPowerAdvice {
  const needsExemption = state.deliveryOn && !state.unrestricted
  return {
    showRow: needsExemption,
    promptOnEnable: !state.unrestricted,
    promptOnOpen: needsExemption,
    caption: needsExemption ? UNRESTRICTED_BATTERY_CAPTION : ''
  }
}
