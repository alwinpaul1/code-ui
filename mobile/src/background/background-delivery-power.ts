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
  /** Milliseconds since this install was last asked on open, or null if never.
   *  Absent on the switch-on path, which asks regardless.
   *
   *  Was "asked in THIS app version", which is what made every release ask
   *  again: nothing records the ANSWER, so Allow only suppressed the prompt
   *  because the exemption then existed, while "Not now" stored nothing at all.
   *  Two releases inside an hour meant two prompts (2026-09-17). A version
   *  number is not evidence that somebody's answer has changed; elapsed time at
   *  least correlates with it. */
  askedAgo?: number | null
  /** The exemption was granted when the app last looked. Going from granted to
   *  not granted is a REVOCATION — by the user, or by Android's own adaptive
   *  battery — and leaves the app in exactly the state this mechanism exists to
   *  prevent. It is worth one more ask even within a version already asked. */
  wasUnrestricted?: boolean
}

export type BackgroundDeliveryPowerAdvice = {
  /** Show the "Allow unrestricted battery use" row. */
  showRow: boolean
  /** Open the system exemption prompt as part of switching delivery on. */
  promptOnEnable: boolean
  /** Ask when the app OPENS with delivery already on and no exemption.
   *
   *  Without this, someone who already had notifications on and merely updated
   *  the app was never asked: the prompt hung off switching delivery on, and
   *  they never switch anything. The settings row was the only other surface
   *  and is only seen by someone who goes looking, so they got slow
   *  notifications indefinitely with nothing saying why (2026-09-15).
   *
   *  At most once per BACKGROUND_POWER_ASK_COOLDOWN_MS, plus once more if a
   *  grant we had is taken away. The row stays either way. */
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

export const UNRESTRICTED_BATTERY_CAPTION =
  'Android pauses background connections to save power, so notifications can wait until you open the app. Allow unrestricted battery use to keep them instant.'

/**
 * How long a "Not now" is believed.
 *
 * Long enough that a run of releases cannot turn into a run of prompts, short
 * enough that someone whose notifications are quietly late is reminded while
 * they still care. Two weeks is roughly the interval at which the annoyance is
 * a reminder rather than nagging.
 */
export const BACKGROUND_POWER_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

function askedRecently(askedAgo: number | null | undefined): boolean {
  if (askedAgo === null || askedAgo === undefined) {
    return false
  }
  // A negative age means the clock moved backwards — a timezone change, NTP, or
  // the user setting it by hand. Treating that as "asked in the future" would
  // suppress the prompt until the clock caught up, which could be for ever.
  if (askedAgo < 0) {
    return false
  }
  return askedAgo < BACKGROUND_POWER_ASK_COOLDOWN_MS
}

export function adviseBackgroundDeliveryPower(
  state: BackgroundDeliveryPowerState
): BackgroundDeliveryPowerAdvice {
  const needsExemption = state.deliveryOn && !state.unrestricted
  return {
    showRow: needsExemption,
    promptOnEnable: !state.unrestricted,
    promptOnOpen:
      needsExemption && (!askedRecently(state.askedAgo) || state.wasUnrestricted === true),
    caption: needsExemption ? UNRESTRICTED_BATTERY_CAPTION : ''
  }
}
