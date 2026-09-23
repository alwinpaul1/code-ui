import { describe, expect, it } from 'vitest'
import { planReplayPresentation, REPLAY_STALE_AFTER_MS } from './notification-replay-plan'
import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'

const NOW = 1_000_000_000

function note(
  id: string,
  worktreeId: string | undefined,
  ageMs: number | undefined
): NotificationEvent {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: 't',
    body: 'b',
    worktreeId,
    notificationId: id,
    ...(ageMs === undefined ? {} : { emittedAt: NOW - ageMs })
  }
}

function dismiss(id: string): DismissNotificationEvent {
  return { type: 'dismiss', notificationId: id }
}

describe('which replayed notifications may still pop', () => {
  it('plans nothing for an empty replay', () => {
    expect(planReplayPresentation([], NOW)).toEqual([])
  })

  it('shows the only event of a one-event replay while it is recent', () => {
    expect(planReplayPresentation([note('a', 'w1', 1000)], NOW)).toEqual(['show'])
  })

  it('asks before popping the only event of a one-event replay once it is old', () => {
    expect(planReplayPresentation([note('a', 'w1', REPLAY_STALE_AFTER_MS + 1)], NOW)).toEqual([
      'quiet'
    ])
  })

  it('shows an event exactly at the stale boundary', () => {
    expect(planReplayPresentation([note('a', 'w1', REPLAY_STALE_AFTER_MS)], NOW)).toEqual(['show'])
  })

  it('silences a notification whose dismiss comes later in the batch, and still runs the dismiss', () => {
    expect(planReplayPresentation([note('a', 'w1', 0), dismiss('a')], NOW)).toEqual([
      'silent',
      'show'
    ])
  })

  it('does not let a dismiss that came BEFORE a reused id silence the later notification', () => {
    expect(planReplayPresentation([dismiss('a'), note('a', 'w1', 0)], NOW)).toEqual([
      'show',
      'show'
    ])
  })

  it('keeps only the last word of each session', () => {
    expect(
      planReplayPresentation(
        [note('a', 'w1', 0), note('b', 'w2', 0), note('c', 'w1', 0), note('d', 'w2', 0)],
        NOW
      )
    ).toEqual(['silent', 'silent', 'show', 'show'])
  })

  it('treats host-level notifications as one session of their own', () => {
    expect(
      planReplayPresentation([note('a', undefined, 0), note('b', 'w1', 0), note('c', undefined, 0)], NOW)
    ).toEqual(['silent', 'show', 'show'])
  })

  it('keeps a session speaking after its dismissed notification', () => {
    // The dismissed one is silent; the session's later word is still news.
    expect(
      planReplayPresentation([note('a', 'w1', 0), dismiss('a'), note('b', 'w1', 0)], NOW)
    ).toEqual(['silent', 'show', 'show'])
  })

  it('does not age an event whose desktop sent no emittedAt, or a garbled one', () => {
    const garbled = { ...note('b', 'w2', undefined), emittedAt: Number.NaN }
    expect(planReplayPresentation([note('a', 'w1', undefined), garbled], NOW)).toEqual([
      'show',
      'show'
    ])
  })

  it('plans past a malformed entry instead of throwing, so the batch still drains', () => {
    const batch = [null, note('a', 'w1', 0)] as unknown as NotificationEvent[]
    expect(planReplayPresentation(batch, NOW)).toEqual(['show', 'show'])
  })

  it('does not age an event stamped ahead of the phone clock', () => {
    expect(planReplayPresentation([note('a', 'w1', -60_000)], NOW)).toEqual(['show'])
  })
})
