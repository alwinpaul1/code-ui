import * as Notifications from 'expo-notifications'
import { notificationTrigger } from './local-notification-scheduling'
import type { PromptAnswerOutcome } from './permission-notification-response'

/** The ways a typed reply ends without being written. */
export type ReplyVerdict = Exclude<PromptAnswerOutcome, 'sent' | 'not-an-answer'>

/** Marks the verdict line so a later re-post replaces it instead of stacking. */
const VERDICT_MARK = '⚠ '

/** One line, in the user's terms, for why the reply was not sent. */
export function replyVerdictLine(outcome: ReplyVerdict): string {
  switch (outcome) {
    case 'refused':
      return `${VERDICT_MARK}Reply not sent — use a number like 2 or 1,3 (one answer per question, separated by ;), or type words`
    case 'stale':
      return `${VERDICT_MARK}Reply not sent — the agent has moved on`
    case 'failed':
      return `${VERDICT_MARK}Reply not sent — check the session`
    case 'offline':
    case 'unroutable':
      return `${VERDICT_MARK}Reply not sent — not connected`
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
}

function withoutVerdict(body: string): string {
  return body.startsWith(VERDICT_MARK) ? body.slice(body.indexOf('\n') + 1) : body
}

/** What the re-post reads off the response: the banner as it was posted. */
export type RepostableResponse = {
  notification: {
    request: {
      identifier: string
      content: {
        title?: string | null
        body?: string | null
        data?: Record<string, unknown> | null
        categoryIdentifier?: string | null
      }
    }
  }
}

/**
 * Post the banner again, with the verdict on its first line.
 *
 * After a reply typed into the shade, Android shows the typed text with a
 * spinner until the app updates or dismisses the notification. A reply that
 * was sent is cleared by the desktop's own dismiss when the agent moves on; a
 * reply that was NOT sent would spin for good, and the user would never learn
 * why. So the banner is replaced under its own identifier — the way the
 * single-banner scheduler replaces a session's banner — with the reason on
 * top and everything else, buttons included, exactly as it was.
 *
 * Never throws: this runs from a notification response handler.
 */
export async function repostBannerWithReplyVerdict(
  response: RepostableResponse,
  outcome: ReplyVerdict
): Promise<void> {
  const { identifier, content } = response.notification.request
  const body = withoutVerdict(content.body ?? '')
  try {
    await Notifications.dismissNotificationAsync(identifier).catch(() => undefined)
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        ...(content.title ? { title: content.title } : {}),
        body: `${replyVerdictLine(outcome)}\n${body}`.trimEnd(),
        ...(content.data ? { data: content.data } : {}),
        ...(content.categoryIdentifier ? { categoryIdentifier: content.categoryIdentifier } : {})
      },
      trigger: notificationTrigger()
    })
  } catch {
    // The verdict is an improvement on a spinning banner; a re-post the OS
    // refuses leaves the log line the answer path already wrote.
  }
}
