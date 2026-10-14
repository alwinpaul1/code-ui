import * as Notifications from 'expo-notifications'
import { notificationTrigger } from './local-notification-scheduling'
import type { PromptAnswerOutcome } from './permission-notification-response'
import { SESSION_REPLY_FAILURE_LINES } from './session-reply-failure'

/** The ways a typed reply ends without being written. */
export type ReplyVerdict = Exclude<PromptAnswerOutcome, 'sent' | 'not-an-answer'>

/** Opens every verdict line, so a later re-post replaces it instead of
 *  stacking. Words only: the warning icon beside it is drawn by the native
 *  view from `data.replyVerdict` (notification-status-icon.ts). */
const VERDICT_MARK = 'Reply not sent — '

/** What a failed tap was: an answer to a question (the default), or Deny with comment. */
export type ReplyKind = 'question' | 'comment'

/** Deny with comment, not sent. Claude's own "Couldn’t send. Tap to open." for everything that
 *  went wrong with the send (session-reply-failure.ts); the one thing a comment can also be is
 *  late, when the agent has moved on to something else. */
export function commentVerdictLine(outcome: ReplyVerdict): string {
  return outcome === 'stale'
    ? 'Comment not sent — the agent has moved on'
    : SESSION_REPLY_FAILURE_LINES.generic
}

/** One line, in the user's terms, for why the reply was not sent. */
export function replyVerdictLine(outcome: ReplyVerdict): string {
  switch (outcome) {
    case 'refused':
      return `${VERDICT_MARK}use a number like 2 or 1,3 (one answer per question, separated by ;), or type words`
    case 'stale':
      return `${VERDICT_MARK}the agent has moved on`
    case 'failed':
      return `${VERDICT_MARK}check the session`
    case 'offline':
    case 'unroutable':
      return `${VERDICT_MARK}not connected`
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
}

async function stillShown(identifier: string): Promise<boolean> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync()
    return presented.some((item) => item.request?.identifier === identifier)
  } catch {
    return true
  }
}

/** The banner's words without a verdict line an earlier post put on top: the line the banner's
 *  own `replyVerdict` names, else any that opens with the question mark above. */
function withoutVerdict(body: string, previous: unknown): string {
  if (typeof previous === 'string' && previous !== '' && body.startsWith(`${previous}\n`)) {
    return body.slice(previous.length + 1)
  }
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
  outcome: ReplyVerdict,
  kind: ReplyKind = 'question'
): Promise<void> {
  await repostBannerWithVerdictLine(
    response,
    kind === 'comment' ? commentVerdictLine(outcome) : replyVerdictLine(outcome)
  )
}

/** The same re-post for a line that is already worded: a reply's failure line
 *  (session-reply-failure.ts). The line is recorded on the banner as `replyVerdict`, which the
 *  native view draws its warning from and a later re-post reads to take the line off again. */
export async function repostBannerWithVerdictLine(response: RepostableResponse, verdict: string): Promise<void> {
  const { identifier, content } = response.notification.request
  const body = withoutVerdict(content.body ?? '', content.data?.replyVerdict)
  try {
    // The reply field can be open while the desktop's dismiss lands (the
    // agent was answered at the desk); the reply then ends 'stale', and a
    // re-post would bring back a banner the desktop had just cleared, with
    // nothing to clear it again. A banner the OS no longer shows stays gone.
    // When the OS cannot say, the re-post goes ahead: a spinning banner with
    // no word is the worse of the two.
    if (!(await stillShown(identifier))) {
      return
    }
    await Notifications.dismissNotificationAsync(identifier).catch(() => undefined)
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        ...(content.title ? { title: content.title } : {}),
        body: `${verdict}\n${body}`.trimEnd(),
        data: { ...content.data, replyVerdict: verdict },
        ...(content.categoryIdentifier ? { categoryIdentifier: content.categoryIdentifier } : {})
      },
      trigger: notificationTrigger()
    })
  } catch {
    // The verdict is an improvement on a spinning banner; a re-post the OS
    // refuses leaves the log line the answer path already wrote.
  }
}
