/** What the chat says when a Stop did not take: the Claude app's own words for a failed
 *  interrupt (1.261009.20, `ccr_stop_session_failed`, parity gap G24).
 *
 *  The words are the same on every lane and for every cause: the terminal's refused or
 *  unanswered Escapes, a tab with no terminal, an agent still working after Stop, and the
 *  structured lane's cancel. The cause is not lost: each lane writes it to the log as one
 *  `[stop] ...` line (native-chat-stop-failure-words.test.tsx), where a user cannot act on it
 *  but a bug report can.
 *
 *  NOT for a Stop whose answer was lost after the key was written. That one may have worked,
 *  so "couldn't stop" would be a claim nobody can back, and it would invite a second Escape
 *  into changed state; it keeps "Stop unconfirmed — check chat before retrying". */
export const STOP_FAILED_MESSAGE = "Couldn't stop the session. Try again."
