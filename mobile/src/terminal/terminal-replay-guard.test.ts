import { describe, expect, it } from 'vitest'
import { isTerminalQueryReply } from '../../../src/shared/terminal-query-reply'
import { createTerminalReplayGuard } from './terminal-replay-guard'

// The tail of a real host snapshot for a 54-row, 135-column tab. Every
// serialization ends with an absolute cursor restore; see
// src/shared/terminal-serialize-absolute-cursor.ts.
const SNAPSHOT_CURSOR_RESTORE = '[54;1H'

describe('the replay guard', () => {
  it('suppresses input for as long as the snapshot write is in flight', async () => {
    const guard = createTerminalReplayGuard()
    expect(guard.suppressed()).toBe(false)
    let suppressedDuringWrite = false
    await guard.replay(async () => {
      suppressedDuringWrite = guard.suppressed()
      await Promise.resolve()
    })
    expect(suppressedDuringWrite).toBe(true)
    // A keystroke after the replay is live input again.
    expect(guard.suppressed()).toBe(false)
  })

  it('stays suppressed until the last of several overlapping replays drains', async () => {
    const guard = createTerminalReplayGuard()
    let releaseFirst: () => void = () => undefined
    const first = guard.replay(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    await guard.replay(async () => undefined)
    expect(guard.suppressed()).toBe(true)
    releaseFirst()
    await first
    expect(guard.suppressed()).toBe(false)
  })

  it('lifts the suppression even when the write throws', async () => {
    const guard = createTerminalReplayGuard()
    await guard
      .replay(() => {
        throw new Error('native write failed')
      })
      .catch(() => undefined)
    expect(guard.suppressed()).toBe(false)
  })

  it("pins that a snapshot's cursor restore is not a query reply, so nothing else stops it", () => {
    // It fails every reply grammar (those end R, n, c, t, y or u, or are
    // OSC/DCS framed), so without the guard it left as ordinary input and the
    // agent's TUI rendered it as typed text.
    expect(isTerminalQueryReply(SNAPSHOT_CURSOR_RESTORE)).toBe(false)
  })
})
