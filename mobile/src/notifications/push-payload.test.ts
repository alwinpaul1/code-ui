import { describe, expect, it } from 'vitest'
import { parsePushPayload } from './push-payload'

/**
 * FCM's data block is a FLAT MAP OF STRINGS. There is no nesting and there are
 * no numbers: a sender that puts `notificationSeq: 42` on the wire delivers
 * `"42"` to the phone. Every fixture here is written the way the transport
 * actually hands it over, because a parser tested against a JS object with real
 * numbers agrees with itself and still drops every seq in production.
 */
describe('reading an FCM data payload into a notification event', () => {
  it('turns the string seq FCM delivers back into a number', () => {
    const parsed = parsePushPayload({
      t: 'notification',
      hostId: 'host-a',
      source: 'agent-task-complete',
      title: 'Claude',
      body: 'Finished the refactor',
      worktreeId: 'wt-1',
      notificationId: 'n-7',
      notificationSeq: '42',
      notificationEpoch: 'epoch-1'
    })
    expect(parsed).toEqual({
      hostId: 'host-a',
      event: {
        type: 'notification',
        source: 'agent-task-complete',
        title: 'Claude',
        body: 'Finished the refactor',
        worktreeId: 'wt-1',
        notificationId: 'n-7',
        notificationSeq: 42,
        notificationEpoch: 'epoch-1'
      }
    })
  })

  it('reads a dismiss', () => {
    expect(
      parsePushPayload({
        t: 'dismiss',
        hostId: 'host-a',
        notificationId: 'n-7',
        notificationSeq: '43',
        notificationEpoch: 'epoch-1'
      })
    ).toEqual({
      hostId: 'host-a',
      event: {
        type: 'dismiss',
        notificationId: 'n-7',
        notificationSeq: 43,
        notificationEpoch: 'epoch-1'
      }
    })
  })

  // Why keep the notification: a seq only drives catch-up dedup. Dropping the
  // whole banner over an unreadable one costs the reader the message itself.
  it('keeps the notification when the seq is unreadable', () => {
    const parsed = parsePushPayload({
      t: 'notification',
      hostId: 'host-a',
      source: 'agent-task-complete',
      title: 'Claude',
      body: 'Needs your input',
      notificationSeq: 'not-a-number'
    })
    expect(parsed?.event).toMatchObject({ type: 'notification', body: 'Needs your input' })
    expect(parsed?.event).not.toHaveProperty('notificationSeq')
  })

  // Why not reject: an unknown source means a desktop newer than this build. The
  // banner still carries the text; only the screen it opens is a guess.
  it('falls back to the default source rather than dropping a newer one', () => {
    expect(
      parsePushPayload({
        t: 'notification',
        hostId: 'host-a',
        source: 'plugin',
        title: 'Claude',
        body: 'Hook fired'
      })?.event
    ).toMatchObject({ source: 'agent-task-complete' })
  })

  // Failure path. Each of these would otherwise render a banner with nothing in
  // it, or one that cannot be routed, which is worse than showing none.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a JSON string instead of a map', '{"t":"notification"}'],
    ['an empty map', {}],
    ['no hostId, so nothing can be routed or deduped', { t: 'notification', title: 'a', body: 'b' }],
    ['no title', { t: 'notification', hostId: 'host-a', body: 'b' }],
    ['no body', { t: 'notification', hostId: 'host-a', title: 'a' }],
    ['a blank body', { t: 'notification', hostId: 'host-a', title: 'a', body: '   ' }],
    ['an unknown type', { t: 'ping', hostId: 'host-a', title: 'a', body: 'b' }],
    ['a dismiss with no notificationId', { t: 'dismiss', hostId: 'host-a' }]
  ])('returns null for %s', (_label, payload) => {
    expect(parsePushPayload(payload)).toBeNull()
  })

  // Degenerate: the transport can hand over numbers on some paths (a local
  // test send, a gateway that forgets to stringify). Accept both shapes.
  it('accepts a seq that already arrived as a number', () => {
    expect(
      parsePushPayload({
        t: 'notification',
        hostId: 'host-a',
        title: 'a',
        body: 'b',
        notificationSeq: 9
      })?.event
    ).toMatchObject({ notificationSeq: 9 })
  })
})
