/**
 * Asking for the battery exemption at the moment the app finds out it was
 * paused, with the pause itself as the reason.
 *
 * Why: "Reconnecting" after a long spell in the background, and no
 * notifications once the app left Recents, were both Android pausing the app
 * (2026-09-23, the connection log: hours with no timer running). Only the
 * Unrestricted battery setting stops that, and the once-per-version ask on
 * open had been dismissed or never seen. A pause the app has just lived
 * through is the one moment the cost is concrete.
 *
 * Once per run of the app: a phone that stays optimised pauses it again and
 * again, and asking each time would be nagging. The settings row remains.
 */
let askedThisRun = false

export function promptAfterPause(args: { pausedMs: number; unrestricted: boolean }): boolean {
  if (args.unrestricted || askedThisRun) {
    return false
  }
  askedThisRun = true
  return true
}

export function resetPromptAfterPauseForTests(): void {
  askedThisRun = false
}

export function backgroundPowerPausedPrompt(pausedMs: number): {
  title: string
  body: string
  confirm: string
  dismiss: string
} {
  return {
    title: 'Android paused Code UI',
    body:
      `Android stopped Code UI for ${formatPause(pausedMs)} while it was in the background, so the connection ` +
      'dropped and notifications could not arrive. Set its battery use to Unrestricted to keep it running.',
    confirm: 'Allow',
    dismiss: 'Later'
  }
}

function formatPause(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
