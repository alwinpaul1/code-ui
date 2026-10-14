/**
 * Why a reply typed into a notification did not go, in the Claude Android app's four lines
 * (`tz8.java`: Generic, NeedsReauth, DeviceLocked, Refused; strings.xml
 * `notification_reply_send_failed`, `…_failed_reauth`, `…_failed_locked`, `notification_reply_send_refused`,
 * 1.261009.20). The apostrophes are the typographic ones and the dash is an em dash, as in the app.
 *
 * What each says here:
 *  - generic       the link is down, the desktop did not answer, the words could not be kept: tap the
 *                  banner to open the chat, where whatever was kept is waiting.
 *  - needs-reauth  the phone has no pairing for the desktop any more (the host's credential is
 *                  missing): opening the app is how it is set up again. (The Claude app asks the
 *                  account to sign in again; this is that, for a pairing. Its words are kept.)
 *  - device-locked the phone's secure storage was locked, which it is until the first unlock after a
 *                  restart, so the pairing could not be read (the host's credential is
 *                  temporarily unavailable).
 *  - refused       the session cannot take a message: its tab is gone from the desktop.
 */
export type SessionReplyFailure = 'generic' | 'needs-reauth' | 'device-locked' | 'refused'

export const SESSION_REPLY_FAILURE_LINES: Readonly<Record<SessionReplyFailure, string>> = {
  generic: 'Couldn’t send. Tap to open.',
  'needs-reauth': 'Couldn’t send — Claude needs to check it’s you. Tap to open, then send again.',
  'device-locked': 'Couldn’t send while your device was locked. Unlock, then send again.',
  refused: 'You can’t send new messages here.'
}

export function replyFailureLine(failure: SessionReplyFailure): string {
  return SESSION_REPLY_FAILURE_LINES[failure]
}
