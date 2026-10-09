/**
 * When the app was last out of the foreground, for the clocks a chat send keeps.
 *
 * Why: React Native on Android runs no JS timer while no Activity is resumed,
 * unless a headless task is active (background-link-task.ts), and Android may
 * freeze the whole process. `Date.now()` keeps going all the same. So a send that
 * measures its budget or its wait on the wall clock spends it while the app is
 * away, and on the way back every overdue timer fires at once and reads that time
 * as the desktop's answer. Reported 2026-10-09: "when I press the arrow to send
 * something it shows the send and then after some time when I go again it shows
 * like message not send". The box empties before the body goes, the clear's 150 ms
 * settle is a timer, and a send left there came back with its budget spent and
 * said a bare "Message not sent" (use-mobile-native-chat-send-paused.test.ts).
 *
 * Fed from AppState by the app root (subscribeAppForegroundClock, app/_layout.tsx);
 * kept free of 'react-native' so the send path's modules can read it anywhere. Never
 * fed (a test, a headless start that never comes to the foreground) it reports
 * the app as never having left, which is how every clock behaved before it.
 */

let away = false
/** When the app last came back to the foreground; null before it ever left. */
let backAt: number | null = null
/** When the app last left the foreground; null before it ever did. */
let leftAt: number | null = null

/** AppState said `active` (true) or anything else (false). Repeats are ignored. */
export function noteAppForeground(active: boolean, now = Date.now()): void {
  if (active === !away) {
    return
  }
  away = !active
  if (active) {
    backAt = now
  } else {
    leftAt = now
  }
}

/** How long the app's latest time away overlaps the stretch from `since` until now: a
 *  moment away is not what spent a 15 s budget, a minute is. Earlier times away are
 *  not counted. */
export function appAwayMsSince(since: number, now = Date.now()): number {
  const from = Math.max(leftAt ?? since, since)
  const to = away ? now : (backAt ?? from)
  return Math.max(0, to - from)
}

/** Whether the app was out of the foreground at any moment from `since` until now. */
export function appWasAwaySince(since: number): boolean {
  return away || (backAt !== null && backAt > since)
}

/** When the app came back after its latest time away, or null while it is away now.
 *  Before it has ever left: -Infinity, so every window counts as foreground. */
export function appForegroundSince(): number | null {
  if (away) {
    return null
  }
  return backAt ?? Number.NEGATIVE_INFINITY
}

/** Test-only: the clock is module state and outlives a single test. */
export function resetAppForegroundClockForTests(): void {
  away = false
  backAt = null
  leftAt = null
}

/** The part of React Native's AppState the clock listens to. */
export type AppStateSource = {
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

/** Feeds the clock from AppState: `active` is the foreground, anything else is away
 *  (Android reports `background`). Only changes are heard, so a cold start that reads
 *  `background` for its first moments (mobile-notifications.ts) never counts as away. */
export function subscribeAppForegroundClock(appState: AppStateSource): () => void {
  const subscription = appState.addEventListener('change', (state) => noteAppForeground(state === 'active'))
  return () => subscription.remove()
}
