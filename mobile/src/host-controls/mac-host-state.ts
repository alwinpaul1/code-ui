export type MacLockState = 'locked' | 'unlocked' | 'unknown'
export type MacDisplayState = 'on' | 'off' | 'unknown'
export type MacMuteState = 'muted' | 'unmuted' | 'unknown'

/** What the Mac says about itself right now. Never persisted: a stale answer would
 *  offer Lock to a Mac that is already locked. */
export type MacHostState = { lock: MacLockState; display: MacDisplayState; mute: MacMuteState }

export const UNKNOWN_MAC_HOST_STATE: MacHostState = {
  lock: 'unknown',
  display: 'unknown',
  mute: 'unknown'
}

const MARKER = 'CUIMAC'

// Verified on macOS 26, 2026-09-13. `ioreg`'s CGSSessionScreenIsLocked is the lock
// signal; the tail of `pmset -g log` is the only display signal that works here —
// `pmset -g powerstate IODisplayWrangler` and ioreg's CurrentPowerState both lie.
// The `%s` placeholders matter: the shell paints this command line on the screen too,
// and the format string must not match the marker pattern the parser hunts for.
export const MAC_HOST_STATE_PROBE_COMMAND =
  `printf '${MARKER} lock=%s display=%s mute=%s\\n' ` +
  `"$(ioreg -n Root -d1 -a | plutil -p - | grep -c '"CGSSessionScreenIsLocked" => true')" ` +
  `"$(pmset -g log | grep -iE 'Display is turned (off|on)' | tail -1 | grep -qi 'turned off' && echo off || echo on)" ` +
  // `output muted` is the speaker mute flag; verified round-trip on macOS 26, 2026-09-13.
  `"$(osascript -e 'output muted of (get volume settings)')"` +
  '; exit'

const MARKER_PATTERN = new RegExp(`${MARKER} lock=([01]) display=(on|off) mute=(true|false)\\b`)

/** The last marker painted on the screen, or unknown. Unknown is a real answer here —
 *  it means "show every row" rather than "assume the Mac is awake". */
export function parseMacHostState(lines: string[]): MacHostState {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        display: match[2] === 'off' ? 'off' : 'on',
        mute: match[3] === 'true' ? 'muted' : 'unmuted'
      }
    }
  }
  return UNKNOWN_MAC_HOST_STATE
}
