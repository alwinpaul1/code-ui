import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The shade's buttons are answered by app/_layout.tsx, which cannot be mounted under vitest, so what
// it does is pinned in its source, as notification-route-coordination.test.ts pins the rest of it.
// A bare includes() would find the long comments around this code, so the comments are cut first.

const source = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')
const code = source
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n')
const start = code.indexOf('async function handleNotificationResponse(')
const end = code.indexOf('const initialResponse = getInitialNotificationResponse()', start)
const handler = code.slice(start, end)

describe('the Reply on a finished session, in the root layout', () => {
  it('is answered through the outbox, in the shade, before any other button', () => {
    const reply = handler.indexOf('if (response.actionIdentifier === SESSION_REPLY_ACTION) {')
    const prompt = handler.indexOf('await answerPromptFromNotification(')
    expect(reply).toBeGreaterThanOrEqual(0)
    expect(prompt).toBeGreaterThan(reply)
    const branch = handler.slice(reply, handler.indexOf('return', reply))
    expect(branch).toContain('await answerSessionReplyFromResponse(response, productionSessionReplyIo())')
  })

  it('queues one reply per response: the same one arrives twice at a cold start', () => {
    const reply = handler.indexOf('if (response.actionIdentifier === SESSION_REPLY_ACTION) {')
    const branch = handler.slice(reply, handler.indexOf('return\n      }', reply))
    const key = branch.indexOf('const replyKey = sessionReplyTapKey(response)')
    const guard = branch.indexOf('if (!handledNotificationIdsRef.current.has(replyKey)) {')
    const answer = branch.indexOf('await answerSessionReplyFromResponse(')
    expect(key).toBeGreaterThanOrEqual(0)
    expect(guard).toBeGreaterThan(key)
    expect(branch.indexOf('handledNotificationIdsRef.current.add(replyKey)')).toBeGreaterThan(guard)
    expect(answer).toBeGreaterThan(branch.indexOf('handledNotificationIdsRef.current.add(replyKey)'))
  })

  it('never navigates for a reply, and clears the response like every other button', () => {
    const reply = handler.indexOf('if (response.actionIdentifier === SESSION_REPLY_ACTION) {')
    const closing = handler.indexOf('return\n      }', reply)
    const branch = handler.slice(reply, closing)
    expect(branch).toContain('clearLastNotificationResponse()')
    expect(branch).not.toContain('openNotificationRoute(')
  })
})

describe('Deny with comment, in the root layout', () => {
  it('hands the comment sender to the answer path that types it into Claude Code’s dialog', () => {
    const answered = handler.indexOf('await answerPromptFromNotification(')
    const repost = handler.indexOf('await repostBannerWithReplyVerdict(', answered)
    expect(answered).toBeGreaterThanOrEqual(0)
    expect(repost).toBeGreaterThan(answered)
    expect(handler.slice(answered, repost)).toContain('sendPermissionComment: sendClaudePermissionComment')
  })

  it('re-posts a comment that was not sent with a comment’s words, and a question’s reply with its own', () => {
    expect(handler).toContain("response.actionIdentifier === PERMISSION_COMMENT_ACTION ? 'comment' : 'question'")
  })
})
