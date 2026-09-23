import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'
import type { ReplayPresentation, ReplayStep } from './notification-replay-plan'

type ReplayEvent = NotificationEvent | DismissNotificationEvent

export type ReplayDrainDependencies = {
  events: readonly ReplayEvent[]
  steps: readonly ReplayStep[]
  /** The seq the batch was asked from: everything at or below it is delivered. */
  askedFrom: number
  /** What a planned 'show' becomes right now (the app-open rule). */
  presentationFor: (planned: ReplayPresentation) => ReplayPresentation
  /** Deliver one event: show, dismiss, retire or silence it, then mark it seen
   *  and advance the watermark. Rejects when a show fails. */
  deliver: (event: ReplayEvent, presentation: ReplayPresentation) => Promise<void>
  isDisposed: () => boolean
  /** Hold the persisted watermark at this seq while an earlier event is still
   *  waiting on the one that supersedes it. */
  holdWatermarkAt: (seq: number) => void
}

export type ReplayDrainResult = {
  /** Every event settled. */
  drained: boolean
  /** Highest seq such that every event up to it is settled. */
  contiguousSeq: number
}

/**
 * Drain one planned catch-up batch, in order.
 *
 * Why a silenced word waits for the one that supersedes it (2026-09-23 review):
 * delivered on the spot, it moved the watermark and the seen-set past itself
 * before anything for its session had reached the user. If the batch then broke
 * off — a show that threw, the process dying — the next catch-up asked from past
 * it, and with a desktop restart in between the session's word was lost
 * outright, where the old flow had at least posted the older one. So it settles
 * only when its superseder does, and the watermark holds below it until then.
 *
 * And when the batch does break off on a failed show, the newest silenced word
 * of each session whose superseder never landed gets one try at a banner of its
 * own: the one the old flow would have left on screen. Not after a teardown — a
 * torn-down host must stop pushing.
 */
export async function drainReplayBatch(deps: ReplayDrainDependencies): Promise<ReplayDrainResult> {
  const { events, steps } = deps
  const settled: boolean[] = Array.from({ length: events.length }, () => false)
  let frontier = 0
  let contiguousSeq = deps.askedFrom
  // Superseder index → the silenced events waiting on it, oldest first.
  const waiting = new Map<number, number[]>()

  function settle(index: number): void {
    settled[index] = true
    while (frontier < events.length && settled[frontier]) {
      contiguousSeq = seqOf(events[frontier]) ?? contiguousSeq
      frontier += 1
    }
  }

  async function settleWaitingOn(index: number): Promise<void> {
    for (const silenced of waiting.get(index) ?? []) {
      await deps.deliver(events[silenced], 'silent')
      settle(silenced)
    }
    waiting.delete(index)
  }

  let drained = false
  try {
    for (let index = 0; index < events.length; index += 1) {
      // Re-checked per event: the batch can start before a teardown and still be
      // draining after it, and a torn-down host must stop pushing.
      if (deps.isDisposed()) {
        return { drained: false, contiguousSeq }
      }
      const step = steps[index] ?? { presentation: 'show', supersededBy: null }
      if (step.presentation === 'silent' && step.supersededBy != null) {
        const list = waiting.get(step.supersededBy) ?? []
        list.push(index)
        waiting.set(step.supersededBy, list)
        deps.holdWatermarkAt(contiguousSeq)
        continue
      }
      await deps.deliver(events[index], deps.presentationFor(step.presentation))
      settle(index)
      await settleWaitingOn(index)
    }
    drained = true
  } catch {
    if (!deps.isDisposed()) {
      await postNewestUnsuperseded()
    }
  }
  return { drained, contiguousSeq }

  async function postNewestUnsuperseded(): Promise<void> {
    for (const [superseder, silenced] of waiting) {
      if (settled[superseder]) {
        continue
      }
      const newest = silenced[silenced.length - 1]
      try {
        await deps.deliver(events[newest], deps.presentationFor('show'))
      } catch {
        continue
      }
      // It is on screen, so the older words behind it are superseded for real.
      for (const index of silenced) {
        if (index !== newest) {
          await deps.deliver(events[index], 'silent').catch(() => {})
        }
        settle(index)
      }
    }
  }
}

function seqOf(event: ReplayEvent | undefined): number | undefined {
  return typeof event === 'object' && event !== null ? event.notificationSeq : undefined
}
