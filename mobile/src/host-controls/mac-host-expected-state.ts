import type { MacHostAction } from './mac-host-commands'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState, type MacLockState } from './mac-host-state'

/**
 * How long after an action that finished OK the host's menu draws the state that
 * action left behind straight away, while its probe runs behind the rows.
 *
 * Why there is one at all: every open asked the host again behind a single
 * "Checking the PC…" row, and on Windows that probe starts PowerShell and compiles
 * a type, several seconds each time. A tester running Mute, then the next row, then
 * the next sat on that row after every one of them and read the menu as broken
 * (Aravind, 2026-10-10).
 *
 * Why two minutes: it covers "do one thing, reopen, do the next", the flow that was
 * reported, and stays shorter than the shortest display idle timer a desktop ships
 * with (macOS on battery: two minutes), the likeliest thing to change the host on its
 * own. Past it the menu draws what it last knew, as after any probe, with the lock
 * unasserted (cachedHostStateForRender). A stale row costs one tap that does nothing
 * (Wake on a display already awake), and the probe that still runs on every open
 * replaces the rows within seconds anyway.
 */
export const EXPECTED_HOST_STATE_FRESH_MS = 120_000

/** What the phone last knew about one host, from a probe or from an action. */
export type KnownHostState = {
  state: MacHostState
  /** The client's getLastConnectedAt when this was learnt; another connection drops it. */
  connectedAt: number | null
  /** When this was last learnt. Older than the window, it is no base for an action. */
  at: number
  /** Until when the menu may draw it as the action left it, Unlock included after
   *  our own Lock: set only by an action that finished OK, never by a probe alone.
   *  Outside it the menu still draws what is known, through cachedHostStateForRender. */
  drawUntil: number | null
  /** The lock is 'locked' because a Lock finished OK, not because a probe said so. */
  lockedByAction: boolean
}

/** Whether `known` still describes the host on `connectedAt`, at `now`. */
export function isKnownHostStateCurrent(
  known: KnownHostState | undefined,
  connectedAt: number | null,
  now: number
): known is KnownHostState {
  return known !== undefined && known.connectedAt === connectedAt && now - known.at < EXPECTED_HOST_STATE_FRESH_MS
}

/** The state an action left behind, drawn at once, or null when there is none to draw. */
export function drawableExpectedHostState(
  known: KnownHostState | undefined,
  connectedAt: number | null,
  now: number
): MacHostState | null {
  if (!isKnownHostStateCurrent(known, connectedAt, now) || known.drawUntil === null) {
    return null
  }
  return now < known.drawUntil ? known.state : null
}

/** The same, read while rendering, where the clock may not be read: the window
 *  running out is applied by expireHostExpectations, on a timer, instead. */
export function expectedHostStateForRender(
  known: KnownHostState | undefined,
  connectedAt: number | null
): MacHostState | null {
  return known && known.drawUntil !== null && known.connectedAt === connectedAt ? known.state : null
}

/**
 * What the menu draws at once, before this open's probe has answered, from what an
 * earlier probe or action on the same connection learnt; null when nothing is known
 * on this connection, and the menu draws the rows of a host that has not said.
 *
 * Why: every open threw the last answer away and hid the rows behind one disabled
 * "Checking the Mac…" row, at a different sheet height, for as long as the host took
 * to open a shell and answer, on a Mac and on a PC alike (the user, 2026-10-14). The
 * probe still runs on every open and replaces these rows when it answers.
 *
 * The lock is never drawn 'locked' from here. Unlock types the password into whatever
 * is in front on the Mac (mac-host-sheet-actions.ts), so it follows only what the Mac
 * said on this open, or an expectation inside its window after our own Lock. An
 * unknown lock draws Lock alone, which does nothing to a Mac that is locked already.
 */
export function cachedHostStateForRender(
  known: KnownHostState | undefined,
  connectedAt: number | null
): MacHostState | null {
  if (!known || known.connectedAt !== connectedAt) {
    return null
  }
  return known.state.lock === 'locked' ? { ...known.state, lock: 'unknown' } : known.state
}

/** Whether a probe learnt nothing at all: it timed out, was refused or could not parse. */
export function isUnknownHostState(state: MacHostState): boolean {
  return state.lock === 'unknown' && state.display === 'unknown' && state.mute === 'unknown'
}

/**
 * What the open menu draws: an action's live expectation (already holding this
 * open's probe), else this open's answer, unless it learnt nothing (a timeout, a
 * refused tab) while something is known, else what is known, else the rows of a
 * host that would not say: every row but Unlock.
 *
 * Why not "Checking" when nothing is known: the first open on every connection hid
 * the rows behind it until the host had opened a shell and answered, and the sheet
 * changed height when it did (the user, 2026-10-14). Every row an unknown state
 * offers does nothing harmful to a host already in that state (Lock on a locked Mac,
 * Wake on a display that is on); Unlock, the one that would, needs the Mac to say it
 * is locked first.
 *
 * "Checking" (a disabled row) stays only while an action of the host runs or
 * settles (`settling`): it is what keeps a second run from starting over the first,
 * and what was known before it no longer describes the host.
 */
export function hostStateToDraw(
  expected: MacHostState | null,
  probed: MacHostState | null,
  cached: MacHostState | null,
  settling: boolean
): MacHostState | 'checking' {
  if (expected) {
    return expected
  }
  if (settling) {
    return probed ?? 'checking'
  }
  if (probed && !(cached && isUnknownHostState(probed))) {
    return probed
  }
  return cached ?? probed ?? UNKNOWN_MAC_HOST_STATE
}

/** Stops drawing every expectation whose window has run out; the same object when
 *  none has, so a timer that lands early changes nothing. */
export function expireHostExpectations(
  known: Readonly<Record<string, KnownHostState>>,
  now: number
): Readonly<Record<string, KnownHostState>> {
  const expired = Object.keys(known).filter((hostId) => {
    const drawUntil = known[hostId]?.drawUntil
    return drawUntil !== null && drawUntil !== undefined && now >= drawUntil
  })
  if (expired.length === 0) {
    return known
  }
  const next = { ...known }
  for (const hostId of expired) {
    next[hostId] = { ...known[hostId]!, drawUntil: null }
  }
  return next
}

/** When the next expectation runs out, or null when none is drawn. */
export function nextHostExpectationExpiry(known: Readonly<Record<string, KnownHostState>>): number | null {
  const deadlines = Object.values(known)
    .map((entry) => entry.drawUntil)
    .filter((deadline): deadline is number => deadline !== null)
  return deadlines.length > 0 ? Math.min(...deadlines) : null
}

/**
 * What one action that finished OK leaves behind, on top of what was known before it.
 *
 * Unlock is never offered from an expectation alone, except after a Lock that
 * finished OK. Unlock types the password into whatever is in front on the Mac
 * (mac-host-sheet-actions.ts), so the row must follow what the Mac said. After our
 * own Lock finished OK, offering it is safe: the lock state is the one we just set,
 * and the unlock command checks the lock itself before it types anything
 * (MAC_SCREEN_LOCK_GATE), so a Mac unlocked from its own keyboard since types
 * nothing and says so. A 'locked' carried from a probe under some other action
 * becomes 'unknown' instead, which draws Lock alone until the probe says again.
 *
 * Windows reports no lock state and always offers Lock (windows-host-state.ts), so
 * its Lock leaves the lock as it was. It has no display actions either
 * (windows-host-commands.ts), and its probe reports no display, so a PC's display
 * stays unknown and picks no row.
 */
export function expectedStateAfterAction(args: {
  /** What was known before; used only while it is still current. */
  known: KnownHostState | undefined
  action: MacHostAction
  platform: NodeJS.Platform | null | undefined
  connectedAt: number | null
  now: number
}): KnownHostState {
  const { action } = args
  const prior = isKnownHostStateCurrent(args.known, args.connectedAt, args.now) ? args.known : null
  const before = prior?.state ?? UNKNOWN_MAC_HOST_STATE
  const lockedByAction = (prior?.lockedByAction ?? false) && before.lock === 'locked'
  const mac = args.platform === 'darwin'
  let lock: MacLockState = before.lock === 'locked' && !lockedByAction ? 'unknown' : before.lock
  if (action === 'lock' && mac) {
    lock = 'locked'
  } else if (action === 'unlock') {
    // Not 'unlocked': the command reports done after a wrong password too, and
    // after macOS refused it the keystrokes (mac-host-commands.ts). Unknown draws
    // the same row, Lock alone, without claiming the Mac let the user in.
    lock = 'unknown'
  } else if (action === 'sleep-display' && mac && lock === 'unlocked') {
    // A Mac set to ask for its password when the display sleeps locks with it.
    lock = 'unknown'
  }
  const display =
    action === 'sleep-display' ? 'off' : action === 'wake-display' ? 'on' : before.display
  const mute = action === 'mute' ? 'muted' : action === 'unmute' ? 'unmuted' : before.mute
  return {
    state: { lock, display, mute },
    connectedAt: args.connectedAt,
    at: args.now,
    drawUntil: args.now + EXPECTED_HOST_STATE_FRESH_MS,
    lockedByAction: lock === 'locked' && ((action === 'lock' && mac) || lockedByAction)
  }
}

/** What the phone knows once a probe answered: laid over a live expectation, or on
 *  its own. A probe that learnt nothing keeps what this connection already knew: it
 *  is no evidence the host changed, and the next open still draws the last rows. */
export function knownAfterProbe(args: {
  known: KnownHostState | undefined
  probed: MacHostState
  connectedAt: number | null
  now: number
}): KnownHostState {
  const { known, probed, connectedAt, now } = args
  if (drawableExpectedHostState(known, connectedAt, now) !== null && known) {
    return { ...mergeProbeIntoExpected(known, probed), at: now }
  }
  if (isUnknownHostState(probed) && known && known.connectedAt === connectedAt) {
    return known
  }
  return { state: probed, connectedAt, at: now, drawUntil: null, lockedByAction: false }
}

/**
 * A probe's answer laid over the expectation it arrived under. What the host said
 * wins; a half it could not say keeps the expected value, because a probe that
 * failed is no evidence the host changed. A probe that failed outright is the
 * expectation unchanged.
 */
export function mergeProbeIntoExpected(expected: KnownHostState, probed: MacHostState): KnownHostState {
  const lock = probed.lock === 'unknown' ? expected.state.lock : probed.lock
  return {
    ...expected,
    state: {
      lock,
      display: probed.display === 'unknown' ? expected.state.display : probed.display,
      mute: probed.mute === 'unknown' ? expected.state.mute : probed.mute
    },
    lockedByAction: expected.lockedByAction && probed.lock === 'unknown' && lock === 'locked'
  }
}
