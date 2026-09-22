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

/** Wakes the screen, gives the login window a beat to accept input, clears the
 *  password field, then types the password and Return. The password is only
 *  ever interpolated here; it must never reach a log line, an error message
 *  or a toast. */
export function buildMacUnlockCommand(password: string): string {
  const lines = [
    'tell application "System Events"',
    `repeat ${CLEAR_PASSWORD_FIELD_DELETES} times`,
    'key code 51',
    'end repeat',
    `keystroke "${escapeAppleScriptString(password)}"`,
    'keystroke return',
    'end tell'
  ]
  const script = lines.map((line) => `-e '${escapeShellSingleQuoted(line)}'`).join(' ')
  return `caffeinate -u -t 2; sleep 1; osascript ${script}${SELF_CLOSE}`
}
