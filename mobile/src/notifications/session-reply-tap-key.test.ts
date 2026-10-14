import { describe, expect, it } from 'vitest'
import { sessionReplyTapKey } from './session-reply-tap-key'

function tap(overrides: { identifier?: string; notificationId?: unknown; date?: number; userText?: string | null } = {}) {
  return {
    userText: overrides.userText === undefined ? 'thanks' : overrides.userText,
    notification: {
      date: overrides.date ?? 1_700_000_000,
      request: {
        identifier: overrides.identifier ?? 'codeui:host-1:wt-1',
        content: {
          title: 't',
          body: 'b',
          data: { hostId: 'host-1', notificationId: overrides.notificationId === undefined ? 'n-1' : overrides.notificationId }
        }
      }
    }
  }
}

// At a cold start the same response arrives twice, once from getLastNotificationResponse and once
// from the listener (notification-routing.ts, notificationTapKey). A body tap is deduplicated by its
// key; a reply is not idempotent (each is a message), so it needs one of its own: the same response
// is the same key, and a reply typed a moment later is not.
describe('the key one typed reply is told by', () => {
  it('is the same for the same response seen twice', () => {
    expect(sessionReplyTapKey(tap())).toBe(sessionReplyTapKey(tap()))
  })

  it('differs for a second reply to the same banner, typed later', () => {
    expect(sessionReplyTapKey(tap({ date: 1_700_000_500 }))).not.toBe(sessionReplyTapKey(tap()))
  })

  it('differs for different words typed into the same banner at the same time', () => {
    expect(sessionReplyTapKey(tap({ userText: 'other words' }))).not.toBe(sessionReplyTapKey(tap()))
  })

  it('differs between banners of two sessions', () => {
    expect(sessionReplyTapKey(tap({ identifier: 'codeui:host-1:wt-2' }))).not.toBe(sessionReplyTapKey(tap()))
  })

  it('differs between two postings of one session’s banner', () => {
    expect(sessionReplyTapKey(tap({ notificationId: 'n-2' }))).not.toBe(sessionReplyTapKey(tap()))
  })

  it('is still made for a banner with no notification id and no words', () => {
    expect(sessionReplyTapKey(tap({ notificationId: undefined, userText: null }))).toEqual(expect.any(String))
  })
})
