export type MacLockState = 'locked' | 'unlocked' | 'unknown'
export type MacDisplayState = 'on' | 'off' | 'unknown'
export type MacMuteState = 'muted' | 'unmuted' | 'unknown'

/** What the Mac says about itself right now. Never persisted: a stale answer would
 *  offer Lock to a Mac that is already locked. */
export type MacHostState = {
  lock: MacLockState
  display: MacDisplayState
  mute: MacMuteState
  /** Set only when the host said its display going off puts it to sleep: a Windows
   *  PC with Modern Standby (windows-host-state.ts). The sheet offers the same rows
   *  there (its Sleep display holds the PC awake first, windows-display-off-keeper.ts);
   *  kept so a later change can tell such a PC apart. */
  sleepsWithDisplay?: true
}

export const UNKNOWN_MAC_HOST_STATE: MacHostState = {
  lock: 'unknown',
  display: 'unknown',
  mute: 'unknown'
}

const MARKER = 'CUIMAC'

// Verified on macOS 26, and again on 27.0 (26A428) on 2026-09-26. `ioreg`'s
// CGSSessionScreenIsLocked is the lock signal, read in ioreg's own text form: it
// prints `"CGSSessionScreenIsLocked"=Yes` on a locked Mac (checked on one). The XML form piped through
// `plutil -p` said the same thing and cost more, because plutil parsed 210 KB of
// registry to find one key: 99 ms against 34 ms, the mean of eight interleaved
// runs from a terminal (2026-09-26, Apple Silicon, macOS 27.0), and 1,125 ms
// against 260 ms at background priority on the same Mac under heavy load. The key
// sits deep inside one long line, and `-w0` keeps ioreg from ever clipping it to
// a terminal's width (into a pipe it does not clip today, checked at 80 columns).
/** What a locked session carries in that text form. The unlock command checks for
 *  it too, just before it types (mac-host-commands.ts). */
export const MAC_SCREEN_LOCKED_KEY = '"CGSSessionScreenIsLocked"=Yes'
const LOCK_READ = `ioreg -w0 -n Root -d1 | grep -c '${MAC_SCREEN_LOCKED_KEY}'`

// Mute and display from ONE osascript. Starting osascript is most of what either
// question costs, so asking both in one process saves a whole start: 278 ms for
// the two processes against 208 ms for this one from a terminal, and 2,145 ms
// against 1,571 ms at background priority, same runs. The whole command went from
// 459 ms to 280 ms from a terminal, and 2,712 ms to 1,785 ms at background priority.
//
// Display state comes from CGDisplayIsAsleep, the CoreGraphics call that owns the
// answer, reached through JXA because every Mac ships osascript and not every Mac
// ships python. It read awake / asleep / awake across a real display sleep on
// 2026-09-18. Mute is Standard Additions' `output muted`, the same flag the
// AppleScript read gave.
//
// Each half answers "unknown" on its own when it cannot say. An output device
// macOS cannot mute (HDMI or DisplayPort audio, typically) reports `missing
// value`; the old AppleScript read printed those words, the marker could not
// parse, and the probe sat out its whole 12 s budget before offering every row.
// Found by reading, not seen here: this Mac's own output answers true or false.
//
// No `'` (the script sits inside one) and no `!` (bash expands it on an
// interactive command line, quotes or not).
const MUTE_AND_DISPLAY_JXA = [
  'var m="unknown",d="unknown";',
  'try{var a=Application.currentApplication();a.includeStandardAdditions=true;',
  'var v=a.getVolumeSettings().outputMuted;m=v===true?"true":v===false?"false":"unknown"}catch(e){}',
  'try{ObjC.import("CoreGraphics");d=$.CGDisplayIsAsleep($.CGMainDisplayID())?"off":"on"}catch(e){}',
  'm+" display="+d'
].join('')

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
// too, and the format string must not match the marker the parser hunts for. The
// closing `end` is what says the line is whole: an osascript that printed nothing
// leaves `mute= end`, which is still an honest lock answer.
export const MAC_HOST_STATE_PROBE_COMMAND =
  `printf '${MARKER} lock=%s mute=%s end\\n' ` +
  `"$(${LOCK_READ})" ` +
  `"$(osascript -l JavaScript -e '${MUTE_AND_DISPLAY_JXA}')"`

const MARKER_PATTERN = new RegExp(
  `${MARKER} lock=([01]) mute=(true|false|unknown)?(?: display=(on|off|unknown))? end\\b`
)

/** The last marker painted on the screen, or null while there is none. */
export function readMacHostStateMarker(lines: string[]): MacHostState | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        display: match[3] === 'on' ? 'on' : match[3] === 'off' ? 'off' : 'unknown',
        mute: match[2] === 'true' ? 'muted' : match[2] === 'false' ? 'unmuted' : 'unknown'
      }
    }
  }
  return null
}

/** The last marker painted on the screen, or unknown. Unknown is a real answer here —
 *  it means "show every row but Unlock" rather than "assume the Mac is awake". */
export function parseMacHostState(lines: string[]): MacHostState {
  return readMacHostStateMarker(lines) ?? UNKNOWN_MAC_HOST_STATE
}
