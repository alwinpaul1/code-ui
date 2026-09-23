import { describe, expect, it } from 'vitest'
import { planReplayPresentation as planSteps } from './notification-replay-plan'
import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'

function note(id: string | undefined, worktreeId: string | undefined, extra: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: 't',
    body: 'b',
    worktreeId,
    ...(id === undefined ? {} : { notificationId: id }),
    ...extra
  }
}

function bell(worktreeId: string, body = 'bell'): NotificationEvent {
  return { type: 'notification', source: 'terminal-bell', title: 'Terminal bell', body, worktreeId }
}

function dismiss(id: string): DismissNotificationEvent {
  return { type: 'dismiss', notificationId: id }
}

function planReplayPresentation(events: (NotificationEvent | DismissNotificationEvent)[]) {
  return planSteps(events).map((step) => step.presentation)
}

describe('which replayed notifications may still pop', () => {
  it('plans nothing for an empty replay', () => {
    expect(planReplayPresentation([])).toEqual([])
  })

  it('shows the only event of a one-event replay', () => {
    expect(planReplayPresentation([note('a', 'w1')])).toEqual(['show'])
  })

  it('retires a notification whose dismiss comes later in the batch, and still runs the dismiss', () => {
    expect(planReplayPresentation([note('a', 'w1'), dismiss('a')])).toEqual(['retire', 'show'])
  })

  it('does not let a dismiss that came BEFORE a reused id touch the later notification', () => {
    expect(planReplayPresentation([dismiss('a'), note('a', 'w1')])).toEqual(['show', 'show'])
  })

  it('names, for each silenced word, the last word of its banner that supersedes it', () => {
    expect(
      planSteps([note('a', 'w1'), note('b', 'w1'), bell('w1'), note('c', 'w1'), bell('w1')]).map(
        (step) => step.supersededBy
      )
    ).toEqual([3, 3, 4, null, null])
  })

  it('keeps only the last word of each session', () => {
    expect(
      planReplayPresentation([note('a', 'w1'), note('b', 'w2'), note('c', 'w1'), note('d', 'w2')])
    ).toEqual(['silent', 'silent', 'show', 'show'])
  })

  it('silences an earlier word even when a later word of the session is the one dismissed', () => {
    expect(planReplayPresentation([note('a', 'w1'), note('b', 'w1'), dismiss('b')])).toEqual([
      'silent',
      'retire',
      'show'
    ])
  })

  it('keeps a session speaking after its dismissed notification', () => {
    expect(planReplayPresentation([note('a', 'w1'), dismiss('a'), note('b', 'w1')])).toEqual([
      'silent',
      'show',
      'show'
    ])
  })

  it('treats host-level notifications with an id as one session of their own', () => {
    expect(planReplayPresentation([note('a', undefined), note('b', 'w1'), note('c', undefined)])).toEqual([
      'silent',
      'show',
      'show'
    ])
  })

  it('never lets a terminal bell stand in for the finished banner of its worktree', () => {
    // A bell has no notificationId, so it posts a banner of its own, not on the
    // session's identifier: both are on screen when they arrive live.
    expect(planReplayPresentation([note('a', 'w1'), bell('w1')])).toEqual(['show', 'show'])
    expect(planReplayPresentation([bell('w1'), note('a', 'w1')])).toEqual(['show', 'show'])
  })

  it('silences only an exact repeat of an id-less line', () => {
    expect(planReplayPresentation([bell('w1'), bell('w1'), bell('w2'), bell('w1', 'other')])).toEqual([
      'silent',
      'show',
      'show',
      'show'
    ])
  })

  it('keeps two plugin notifications apart, since neither has a worktree or an id', () => {
    // Stock Orca's dispatchPlugin sends `source: 'plugin'`, which the phone's
    // DesktopNotificationSource does not list yet; the wire value is what is tested.
    const plugin = 'plugin' as NotificationEvent['source']
    const ci = note(undefined, undefined, { source: plugin, title: 'ci: failed', body: 'x' })
    const deploy = note(undefined, undefined, { source: plugin, title: 'deploy: done', body: 'y' })
    expect(planReplayPresentation([ci, deploy])).toEqual(['show', 'show'])
  })

  it('does not age anything: a notification with no dismiss is one the desk has not acknowledged', () => {
    const old = { ...note('a', 'w1'), emittedAt: 0 } as NotificationEvent
    expect(planReplayPresentation([old])).toEqual(['show'])
  })

  it('plans past a malformed entry instead of throwing, so the batch still drains', () => {
    const batch = [null, note('a', 'w1')] as unknown as NotificationEvent[]
    expect(planReplayPresentation(batch)).toEqual(['show', 'show'])
  })
})
