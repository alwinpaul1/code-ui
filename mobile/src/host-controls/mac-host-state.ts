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
// Display state comes from CGDisplayIsAsleep, the CoreGraphics call that owns the
// answer, reached through JXA because every Mac ships osascript and not every Mac
// ships python. 70 ms. It read awake / asleep / awake across a real display sleep
// on 2026-09-18.
//
// Why not a power-state proxy: on 2026-09-14 the only source that answered was
// `pmset -g log`, which dumps the whole power log — 28 SECONDS against a 4-second
// budget — so the probe timed out and lock and mute, which are cheap and were
// right, were lost with it. Both display rows showed on every Mac from then on
// ("Wake display" on a Mac whose display was on). On 2026-09-18 the ioreg
// candidates were measured across a real sleep: IOMobileFramebuffer reads
// CurrentPowerState=1 awake AND asleep, and a full device-tree diff showed no
// display node changing state within four seconds — only the video decoder,
// camera and Neural Engine, which is background work. A proxy was never going to
// say it.
//
// The `%s` placeholders matter: the shell paints this command line on the screen
// too, and the format string must not match the marker the parser hunts for.
export const MAC_HOST_STATE_PROBE_COMMAND =
  `printf '${MARKER} lock=%s mute=%s display=%s\\n' ` +
  `"$(ioreg -n Root -d1 -a | plutil -p - | grep -c '"CGSSessionScreenIsLocked" => true')" ` +
  `"$(osascript -e 'output muted of (get volume settings)')" ` +
  `"$(osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); $.CGDisplayIsAsleep($.CGMainDisplayID()) ? "off" : "on"')"`

// `display` is optional: a line from a build that did not ask, or a Mac where the
// JXA call printed nothing, is still two honest answers.
const MARKER_PATTERN = new RegExp(`${MARKER} lock=([01]) mute=(true|false)(?: display=(on|off))?\\b`)

/** The last marker painted on the screen, or unknown. Unknown is a real answer here —
 *  it means "show every row" rather than "assume the Mac is awake". */
export function parseMacHostState(lines: string[]): MacHostState {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        display: match[3] === 'on' ? 'on' : match[3] === 'off' ? 'off' : 'unknown',
        mute: match[2] === 'true' ? 'muted' : 'unmuted'
      }
    }
  }
  return UNKNOWN_MAC_HOST_STATE
}
