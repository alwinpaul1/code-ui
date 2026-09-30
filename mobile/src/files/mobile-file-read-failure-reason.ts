import { cutWholeCharacters } from '../text/whole-character-cut'
import { isTerminalArtifactGrantError } from './terminal-artifact-grant-error'

// Split from mobile-file-whole-read.ts so that file stays under the line cap.

/** Plain words for the failures that have them; the desktop's own text for the rest, because it is
 *  the only clue a failure on an untested host leaves. That text is cut at 140 code units, never
 *  through an emoji a path in it holds. */
export function failureReason(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized === 'outside_worktree') {
    return 'the phone can reach a file outside the workspace only while a terminal here still shows its path'
  }
  if (isTerminalArtifactGrantError(normalized)) {
    return 'the desktop no longer lets the phone read it; open it again from the terminal'
  }
  if (
    normalized.includes('enoent') ||
    normalized.includes('no such file') ||
    normalized.includes('not found') ||
    normalized.includes('does not exist')
  ) {
    return 'it is no longer on the desktop'
  }
  if (
    normalized.includes('remote connection dropped') ||
    normalized.includes('provider unavailable') ||
    normalized.includes('disconnected') ||
    normalized.includes('not connected') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  ) {
    return 'the desktop could not be reached'
  }
  const detail = cutWholeCharacters(message.trim(), 140)
  return detail || 'the desktop gave no reason'
}
