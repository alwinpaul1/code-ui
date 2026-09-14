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

// Verified on macOS 26. `ioreg`'s CGSSessionScreenIsLocked is the lock signal and
// `output muted` is the speaker flag; both answer in about a second.
//
// Display state is NOT asked for. `pmset -g log` was the only source that ever
// answered it correctly here, and it dumps the entire power log: measured at 28
// SECONDS on this Mac against a 4-second probe budget, so the whole probe timed
// out and every row showed as unknown — including lock and mute, which are cheap
// and were right (2026-09-14). The alternatives lie or are worse: `pmset -g
// powerstate IODisplayWrangler` fails outright, ioreg's CurrentPowerState tracks
// system sleep rather than the display, and `log show` took 123 seconds. Two
// honest answers beat three where one costs the other two.
//
// The `%s` placeholders matter: the shell paints this command line on the screen
// too, and the format string must not match the marker the parser hunts for.
export const MAC_HOST_STATE_PROBE_COMMAND =
  `printf '${MARKER} lock=%s mute=%s\\n' ` +
  `"$(ioreg -n Root -d1 -a | plutil -p - | grep -c '"CGSSessionScreenIsLocked" => true')" ` +
  `"$(osascript -e 'output muted of (get volume settings)')"`

const MARKER_PATTERN = new RegExp(`${MARKER} lock=([01]) mute=(true|false)\\b`)

/** The last marker painted on the screen, or unknown. Unknown is a real answer here —
 *  it means "show every row" rather than "assume the Mac is awake". */
export function parseMacHostState(lines: string[]): MacHostState {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        // Not asked for; both display rows show, which is the honest answer.
        display: 'unknown',
        mute: match[2] === 'true' ? 'muted' : 'unmuted'
      }
    }
  }
  return UNKNOWN_MAC_HOST_STATE
}
