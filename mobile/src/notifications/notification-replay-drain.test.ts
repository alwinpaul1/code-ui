import { describe, expect, it } from 'vitest'
import { drainReplayBatch } from './notification-replay-drain'
import { planReplayPresentation, type ReplayPresentation } from './notification-replay-plan'
import type { NotificationEvent } from './local-notification-scheduling'

function note(seq: number, worktreeId: string): NotificationEvent {
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: 't',
    body: `b${seq}`,
    worktreeId,
    notificationId: `agent:${seq}`,
    notificationSeq: seq
  }
}

type Run = { delivered: [number, ReplayPresentation][]; holds: number[] }

async function drain(
  events: NotificationEvent[],
  options: { failOn?: (seq: number, presentation: ReplayPresentation) => boolean; disposeAfter?: number } = {}
) {
  const run: Run = { delivered: [], holds: [] }
  let deliveries = 0
  const result = await drainReplayBatch({
    events,
    steps: planReplayPresentation(events),
    askedFrom: 5,
    presentationFor: (planned) => planned,
    deliver: async (event, presentation) => {
      deliveries += 1
      if (options.failOn?.(event.notificationSeq ?? -1, presentation)) {
        throw new Error('show failed')
      }
      run.delivered.push([event.notificationSeq ?? -1, presentation])
    },
    isDisposed: () => options.disposeAfter !== undefined && deliveries >= options.disposeAfter,
    holdWatermarkAt: (seq) => run.holds.push(seq)
  })
  return { ...result, ...run }
}

describe('draining a planned replay batch', () => {
  it('settles an empty batch at the seq it was asked from', async () => {
    expect(await drain([])).toEqual({ drained: true, contiguousSeq: 5, delivered: [], holds: [] })
  })

  it('settles a one-event batch past its only event', async () => {
    const run = await drain([note(6, 'w1')])
    expect(run).toMatchObject({ drained: true, contiguousSeq: 6, delivered: [[6, 'show']] })
  })

  it('delivers a silenced word only once the word superseding it lands, holding the watermark below it meanwhile', async () => {
    const run = await drain([note(6, 'w1'), note(7, 'w2'), note(8, 'w1')])
    expect(run.delivered).toEqual([
      [7, 'show'],
      [8, 'show'],
      [6, 'silent']
    ])
    expect(run.holds).toEqual([5])
    expect(run).toMatchObject({ drained: true, contiguousSeq: 8 })
  })

  it('stops the contiguous point before a silenced word whose superseder failed, after posting that word instead', async () => {
    const run = await drain([note(6, 'w1'), note(7, 'w2'), note(8, 'w1')], {
      failOn: (seq, presentation) => seq === 8 && presentation === 'show'
    })
    // 8 failed, so 6 gets its try; 6 and 7 are settled, 8 is not.
    expect(run.delivered).toEqual([
      [7, 'show'],
      [6, 'show']
    ])
    expect(run).toMatchObject({ drained: false, contiguousSeq: 7 })
  })

  it('leaves the contiguous point before a silenced word when its fallback show fails too', async () => {
    const run = await drain([note(6, 'w1'), note(7, 'w1')], { failOn: () => true })
    expect(run.delivered).toEqual([])
    expect(run).toMatchObject({ drained: false, contiguousSeq: 5 })
  })

  it('posts nothing more once the host is torn down mid-batch, and no fallback', async () => {
    const run = await drain([note(6, 'w1'), note(7, 'w2'), note(8, 'w1')], { disposeAfter: 1 })
    expect(run.delivered).toEqual([[7, 'show']])
    expect(run).toMatchObject({ drained: false, contiguousSeq: 5 })
  })
})
