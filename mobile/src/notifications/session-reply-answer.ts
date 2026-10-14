import {
  dismissAnsweredBanner,
  repostBannerWithVerdictLine,
  type RepostableResponse
} from './question-reply-verdict'
import { replyFailureLine } from './session-reply-failure'
import {
  replyToSessionFromNotification,
  type SessionReplyIo,
  type SessionReplyOutcome
} from './session-reply-response'

/** What a tap on the Reply field gives the answer path: the words, and the banner it came from. */
export type SessionReplyResponse = RepostableResponse & { userText?: string | null }

/**
 * Settles a reply typed into a session's notification, and the banner after it.
 *
 * Android shows the typed words with a spinner until the app updates or dismisses the notification
 * (question-reply-verdict.ts), so every ending does one of the two. A reply that is in the outbox is
 * done with here, and the banner goes. One that did not get there says why, in the Claude app's own
 * line (session-reply-failure.ts), above the banner as it was, with the Reply field still on it only
 * where the words were not kept. Neither touches a newer banner of the same session that took the
 * identifier meanwhile.
 *
 * Never throws: this runs from a notification response handler, sometimes headless.
 */
export async function answerSessionReplyFromResponse(
  response: SessionReplyResponse,
  io: SessionReplyIo
): Promise<SessionReplyOutcome> {
  let outcome: SessionReplyOutcome
  try {
    outcome = await replyToSessionFromNotification({
      userText: response.userText ?? null,
      data: response.notification.request.content.data,
      io
    })
  } catch (error) {
    console.warn('[session-reply] reply failed unexpectedly', error)
    outcome = { kind: 'failed', failure: 'generic', kept: false }
  }
  switch (outcome.kind) {
    case 'queued':
      await dismissAnsweredBanner(response)
      break
    case 'failed':
      console.warn('[session-reply] reply not sent', { failure: outcome.failure, wordsKept: outcome.kept })
      // The Reply field stays only where the words were NOT kept and the session can take a message:
      // words in the outbox are sent by the chat when it is opened, and a second reply typed into
      // the same banner would be a second copy of the message.
      await repostBannerWithVerdictLine(
        response,
        replyFailureLine(outcome.failure),
        !outcome.kept && outcome.failure !== 'refused'
      )
      break
    case 'not-a-reply':
      break
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
  return outcome
}
