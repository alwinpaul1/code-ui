import { describe, expect, it } from 'vitest'
import { buildQueuedCancelWrites } from './mobile-native-chat-queue-cancel'

const UP = '\u001b[A'
const CLEAR_LINE = '\u000b\u0015'

describe('buildQueuedCancelWrites', () => {
  it('takes the queue back, clears it, and re-queues the kept entries', () => {
    expect(
      buildQueuedCancelWrites({ queued: ['first', 'second\nline', 'third'], cancelIndex: 1 })
    ).toEqual([
      { text: UP, enter: false },
      { text: CLEAR_LINE.repeat(4 + 2), enter: false },
      { text: 'first', enter: true },
      { text: 'third', enter: true }
    ])
  })

  it('clears the mirrored draft too and types it back afterwards', () => {
    const writes = buildQueuedCancelWrites({ queued: ['only'], cancelIndex: 0, draft: 'typing' })
    expect(writes[1]).toEqual({ text: CLEAR_LINE.repeat(2 + 2), enter: false })
    expect(writes.at(-1)).toEqual({ text: 'typing', enter: false })
    expect(writes.filter((write) => write.enter)).toHaveLength(0)
  })

  it('does nothing for an index outside the queue', () => {
    expect(buildQueuedCancelWrites({ queued: ['a'], cancelIndex: 3 })).toEqual([])
  })
})
