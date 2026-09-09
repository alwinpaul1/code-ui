import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalLivePendingFlushState,
  queueTerminalLiveMirrorSend,
  waitForTerminalLivePendingFlush
} from './terminal-live-pending-flush-state'

// Measured on a Galaxy S23 over the relay (2026-09-09): Enter after typed text
// cost two round trips — the text frame, then a separate "\r" frame that
// waited for the first reply. PTY bytes are ordered, so both belong in one
// terminal.send.
describe('live input: bytes queued in the same tick ride one terminal.send', () => {
  it('sends text and the Enter that follows it as a single frame', async () => {
    const state = createTerminalLivePendingFlushState()
    const sender = vi.fn(async (_handle: string, _payload: string) => true)

    const text = queueTerminalLiveMirrorSend(state, 't1', 'ls -la', sender)
    const enter = queueTerminalLiveMirrorSend(state, 't1', '\r', sender)

    expect(await Promise.all([text, enter])).toEqual([true, true])
    expect(sender.mock.calls.map(([, payload]) => payload)).toEqual(['ls -la\r'])
  })

  it('keeps later keystrokes in order behind a frame that is already on the wire', async () => {
    const state = createTerminalLivePendingFlushState()
    const sent: string[] = []
    let release: () => void = () => {}
    const sender = vi.fn(
      (_handle: string, payload: string) =>
        new Promise<boolean>((resolve) => {
          sent.push(payload)
          release = () => resolve(true)
        })
    )

    const first = queueTerminalLiveMirrorSend(state, 't1', 'a', sender)
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual(['a'])
    const second = queueTerminalLiveMirrorSend(state, 't1', 'b', sender)
    const third = queueTerminalLiveMirrorSend(state, 't1', '\r', sender)
    release()
    await first
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b\r']))
    release()
    expect(await Promise.all([second, third])).toEqual([true, true])
    expect(await waitForTerminalLivePendingFlush(state)).toBe(true)
  })

  it('reports the whole frame as failed when the send is refused', async () => {
    const state = createTerminalLivePendingFlushState()
    const sender = vi.fn(async () => false)
    const text = queueTerminalLiveMirrorSend(state, 't1', '한', sender)
    const enter = queueTerminalLiveMirrorSend(state, 't1', '\r', sender)
    expect(await Promise.all([text, enter])).toEqual([false, false])
    expect(sender).toHaveBeenCalledTimes(1)
  })
})
