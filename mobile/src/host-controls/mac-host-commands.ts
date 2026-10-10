import { MAC_SCREEN_LOCKED_KEY } from './mac-host-state'

/** The one-tap Mac controls the host card offers on a darwin host. */
export type MacHostAction = 'lock' | 'unlock' | 'sleep-display' | 'wake-display' | 'mute' | 'unmute'

/** Actions whose command needs no secret; Unlock is built by buildMacUnlockCommand. */
export type MacHostPasswordlessAction = Exclude<MacHostAction, 'unlock'>

export const MAC_HOST_ACTION_LABELS: Record<MacHostAction, string> = {
  lock: 'Lock Mac',
  unlock: 'Unlock Mac',
  'sleep-display': 'Sleep display',
  'wake-display': 'Wake display',
  mute: 'Mute Mac',
  unmute: 'Unmute Mac'
}

/** What the toast says while the Mac is being asked. Deliberately says nothing about
 *  the command — the unlock one carries the user's password. */
export const MAC_HOST_ACTION_PROGRESS: Record<MacHostAction, string> = {
  lock: 'Locking the Mac…',
  unlock: 'Unlocking the Mac…',
  'sleep-display': 'Putting the display to sleep…',
  'wake-display': 'Waking the display…',
  mute: 'Muting the Mac…',
  unmute: 'Unmuting the Mac…'
}

// Why a printed marker and not `; exit`: a shell that exits leaves the desktop with a
// dead "Terminal N" tab the phone can no longer close (2026-09-13). The shell stays up,
// prints this once the command is through, and the phone closes the live tab. The
// `%s` keeps the command's own echo on the screen from matching the pattern.
const SELF_CLOSE = `; printf 'CUIDONE %s\\n' ok`
export const MAC_HOST_COMMAND_DONE_PATTERN = /CUIDONE ok\b/

// Why the sleep fallback: `keystroke` needs Accessibility permission for the Orca
// process, and when macOS refuses, osascript exits non-zero. The old CGSession
// binary is gone from macOS 26 (checked 2026-09-13), so the fallback puts the
// display to sleep instead, which locks the Mac wherever "require password after
// sleep" is on — the default, and "immediate" on the machine this was built for.
const LOCK_COMMAND =
  `osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}'` +
  ' || pmset displaysleepnow'

const PASSWORDLESS_COMMANDS: Record<MacHostPasswordlessAction, string> = {
  lock: LOCK_COMMAND,
  'sleep-display': 'pmset displaysleepnow',
  'wake-display': 'caffeinate -u -t 2',
  // Output mute only: the input (microphone) is left alone on purpose.
  mute: `osascript -e 'set volume output muted true'`,
  unmute: `osascript -e 'set volume output muted false'`
}

/** Escapes for an AppleScript double-quoted string literal. */
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Escapes for a POSIX single-quoted shell word. `$` and a backtick need nothing —
 *  single quotes already disarm them — but a single quote must leave and re-enter
 *  the quoting via the '\'' idiom or the argument splits in two. */
function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`)
}

export function buildMacHostCommand(action: MacHostPasswordlessAction): string {
  return `${PASSWORDLESS_COMMANDS[action]}${SELF_CLOSE}`
}

/** Delete key. The login field keeps whatever was already typed, and a saved
 *  password appended to that is the wrong password. Forty deletes clears a
 *  long mistype; on an empty field each one does nothing. */
const CLEAR_PASSWORD_FIELD_DELETES = 40

/** A command saying it did nothing, and why: the Mac unlock's two (the screen was
 *  not locked, or it could not tell), and the Windows Sleep display's one (on a PC
 *  with Modern Standby the display did not report off in time, or the keeper could
 *  not hold the PC awake first, and the keeper put the display timeout back;
 *  windows-display-off-keeper.ts). The word stays `keepawake` from when holding the
 *  PC was the only way it could fail. */
export type MacHostRefusal = 'unlocked' | 'unconfirmed' | 'keepawake'

export const MAC_HOST_REFUSAL_REASONS: Record<MacHostRefusal, string> = {
  unlocked: "The Mac isn't locked, so nothing was typed.",
  unconfirmed: "Couldn't confirm the Mac is locked, so nothing was typed.",
  keepawake: 'The display did not turn off, so nothing was changed.'
}

const ON_CONSOLE_KEY = '"kCGSSessionOnConsoleKey"=Yes'

/**
 * Prints one word: `locked`, `unlocked`, or `unconfirmed` when it cannot tell.
 *
 * Why the unlock asks at all (review, 2026-09-26): it types Deletes, the password
 * and Return as keystrokes into whatever is in front. On a locked Mac that is the
 * login window. On any other Mac it is a chat window, a terminal or a browser
 * field, and the password lands there. The phone's own answer can be minutes old
 * by the time a tap arrives, so the Mac is asked as the command runs.
 *
 * The probe's key (MAC_SCREEN_LOCKED_KEY), in the same `ioreg -w0` text form, but
 * read from the ONE session on the console. Each session is a flat `{…}` in
 * IOConsoleUsers (checked on macOS 27.0, 2026-09-26), so cutting the text at `}`
 * leaves one session per line. A second user switched out behind the one on
 * screen may be locked while the screen in front is not; the probe's grep over
 * the whole registry would call that Mac locked. An ioreg that fails does not
 * count, whatever it printed, and no session on the console is `unconfirmed`.
 * The `(pattern)` form keeps bash 3.2 from misreading a case inside `$(…)`.
 */
export const MAC_SCREEN_LOCK_GATE =
  'cui_s=$(ioreg -w0 -n Root -d1) || cui_s=; ' +
  `case "$(printf '%s\\n' "$cui_s" | tr '}' '\\n' | grep '${ON_CONSOLE_KEY}')" in ` +
  `(*'${MAC_SCREEN_LOCKED_KEY}'*) printf locked ;; ` +
  `(*'${ON_CONSOLE_KEY}'*) printf unlocked ;; ` +
  '(*) printf unconfirmed ;; esac'

// Anchored, and a `%s` in the command: its own echo on the screen must not match.
const REFUSED_PATTERN = /^CUIREFUSED (unlocked|unconfirmed|keepawake)\b/

/** The refusal a command printed, or null while there is none. */
export function readMacHostRefusal(lines: string[]): MacHostRefusal | null {
  for (const line of lines) {
    const match = REFUSED_PATTERN.exec(line)
    if (match) {
      return match[1] === 'unlocked' || match[1] === 'keepawake' ? match[1] : 'unconfirmed'
    }
  }
  return null
}

/** Clears the password field, asks again whether the screen is locked, and only
 *  then types the password and Return. The second ask is the one that counts: a
 *  Watch or Touch ID can let the user in once the wake below has lit the screen,
 *  and the Deletes take a moment. The script's answer is `typed`, or the word
 *  that stopped it. */
export function macUnlockAppleScriptLines(password: string): string[] {
  return [
    'tell application "System Events"',
    `repeat ${CLEAR_PASSWORD_FIELD_DELETES} times`,
    'key code 51',
    'end repeat',
    'end tell',
    `set cuiLock to do shell script "${escapeAppleScriptString(MAC_SCREEN_LOCK_GATE)}"`,
    'if cuiLock is not "locked" then return cuiLock',
    'tell application "System Events"',
    `keystroke "${escapeAppleScriptString(password)}"`,
    'keystroke return',
    'end tell',
    'return "typed"'
  ]
}

/** Wakes the screen, gives the login window a beat to accept input, and runs the
 *  script only if the Mac then says its screen is locked. Otherwise it types
 *  nothing and prints why, and the phone says so. The password is only ever
 *  interpolated here; it must never reach a log line, an error message or a
 *  toast. An osascript that fails (Accessibility refused) still ends in the done
 *  marker, as it always has. */
export function buildMacUnlockCommand(password: string): string {
  const script = macUnlockAppleScriptLines(password)
    .map((line) => `-e '${escapeShellSingleQuoted(line)}'`)
    .join(' ')
  return (
    `caffeinate -u -t 2; sleep 1; cui_lock=$(${MAC_SCREEN_LOCK_GATE}); ` +
    `case $cui_lock in (locked) cui_lock=$(osascript ${script}) || cui_lock=failed ;; esac; ` +
    `case $cui_lock in (typed|failed) printf 'CUIDONE %s\\n' ok ;; ` +
    `(unlocked) printf 'CUIREFUSED %s\\n' unlocked ;; (*) printf 'CUIREFUSED %s\\n' unconfirmed ;; esac`
  )
}
