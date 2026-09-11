import { describe, expect, it } from 'vitest'
import {
  cancelTerminalLivePendingFlush,
  createTerminalLivePendingFlushState,
  queueTerminalLiveMirrorSend,
  waitForTerminalLivePendingFlush
} from './terminal-live-pending-flush-state'

describe('terminal live pending flush state', () => {
  it('Given no in-flight flush When waiting for the barrier Then allows control input', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()

    // When / Then
    await expect(waitForTerminalLivePendingFlush(state)).resolves.toBe(true)
  })

  it('Given an in-flight send When control bytes queue Then they wait for it and go out after it', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    const sent: string[] = []
    let releaseFirst: (sent: boolean) => void = () => {}
    const sender = (_handle: string, payload: string) =>
      new Promise<boolean>((resolve) => {
        sent.push(payload)
        if (payload === 'text') {
          releaseFirst = resolve
        } else {
          resolve(true)
        }
      })
    const text = queueTerminalLiveMirrorSend(state, 'h', 'text', sender)
    await Promise.resolve()
    await Promise.resolve()

    // When
    const control = queueTerminalLiveMirrorSend(state, 'h', '\r', sender, {
      requiresPriorSuccess: true
    })
    await Promise.resolve()

    // Then
    expect(sent).toEqual(['text'])
    releaseFirst(true)
    await expect(text).resolves.toBe(true)
    await expect(control).resolves.toBe(true)
    expect(sent).toEqual(['text', '\r'])
  })

  it('Given an in-flight send that is refused When control bytes wait behind it Then they are skipped', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    const sent: string[] = []
    let releaseFirst: (sent: boolean) => void = () => {}
    const sender = (_handle: string, payload: string) =>
      new Promise<boolean>((resolve) => {
        sent.push(payload)
        if (payload === 'text') {
          releaseFirst = resolve
        } else {
          resolve(true)
        }
      })
    const text = queueTerminalLiveMirrorSend(state, 'h', 'text', sender)
    await Promise.resolve()
    await Promise.resolve()
    const control = queueTerminalLiveMirrorSend(state, 'h', '\r', sender, {
      requiresPriorSuccess: true
    })

    // When
    releaseFirst(false)

    // Then: a control never lands on a PTY line whose text did not
    await expect(text).resolves.toBe(false)
    await expect(control).resolves.toBe(false)
    expect(sent).toEqual(['text'])
  })

  it('Given high RTT When more input queues Then pending bytes share one follow-up send that does not wait', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    const payloads: string[] = []
    let resolveFirstSend: (value: boolean) => void = () => {}
    const sender = async (_handle: string, payload: string): Promise<boolean> => {
      payloads.push(payload)
      if (payloads.length === 1) {
        return new Promise<boolean>((resolve) => {
          resolveFirstSend = resolve
        })
      }
      return true
    }

    // When
    const first = queueTerminalLiveMirrorSend(state, 'terminal-1', 'a', sender)
    // The drain starts on a microtask; let 'a' reach the wire first.
    await Promise.resolve()
    await Promise.resolve()
    const second = queueTerminalLiveMirrorSend(state, 'terminal-1', 'b', sender)
    const third = queueTerminalLiveMirrorSend(state, 'terminal-1', 'c', sender)
    // The drain wakes on a microtask and sends on the next; a few ticks, not a reply.
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve()
    }

    // Then: 'b' and 'c' share one send, and it goes while 'a' is still
    // unanswered — keys no longer wait for the previous reply (2026-09-11;
    // measured at ~410 ms per reply over the relay, typing arrived in clumps).
    expect(payloads).toEqual(['a', 'bc'])
    resolveFirstSend(true)
    await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true])
    expect(payloads).toEqual(['a', 'bc'])
  })

  it('Given four unanswered sends When more keys queue Then the fifth waits for the first reply', async () => {
    const state = createTerminalLivePendingFlushState()
    const payloads: string[] = []
    const releases: ((value: boolean) => void)[] = []
    const sender = (_handle: string, payload: string) =>
      new Promise<boolean>((resolve) => {
        payloads.push(payload)
        releases.push(resolve)
      })
    const sends = ['a', 'b', 'c', 'd', 'e'].map((key, i) => {
      const send = queueTerminalLiveMirrorSend(state, 't', key, sender)
      return { key: i, send }
    })
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
    // Same-tick keys coalesce into one frame; force separate frames by draining ticks.
    expect(payloads.length).toBeGreaterThanOrEqual(1)
    expect(payloads.length).toBeLessThanOrEqual(4)
    releases.forEach((release) => release(true))
    await expect(Promise.all(sends.map(({ send }) => send))).resolves.toEqual([
      true,
      true,
      true,
      true,
      true
    ])
  })

  it('Given a failed previous send When a mirror send queues Then it still runs in order', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    const order: string[] = []
    const first = queueTerminalLiveMirrorSend(state, 'terminal-1', 'first', async () => {
      order.push('first')
      return false
    })

    // When
    const second = queueTerminalLiveMirrorSend(state, 'terminal-1', 'second', async () => {
      order.push('second')
      return true
    })

    // Then
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(order).toEqual(['first', 'second'])
  })

  it('Given a throwing send When a mirror send queues Then the promise resolves false and the chain continues', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    const first = queueTerminalLiveMirrorSend(state, 'terminal-1', 'first', async () => {
      throw new Error('boom')
    })

    // When
    const second = queueTerminalLiveMirrorSend(state, 'terminal-1', 'second', async () => true)

    // Then
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
  })

  it('Given a settled mirror send When it was the newest Then the state resets to null', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()

    // When
    await queueTerminalLiveMirrorSend(state, 'terminal-1', 'payload', async () => true)
    await Promise.resolve()

    // Then
    expect(state.current).toBeNull()
  })

  it('Given queued input When the queue is cancelled Then unsent input is dropped', async () => {
    // Given
    const state = createTerminalLivePendingFlushState()
    let resolveSend: (value: boolean) => void = () => {}
    const sender = async (): Promise<boolean> =>
      new Promise((resolve) => {
        resolveSend = resolve
      })
    const active = queueTerminalLiveMirrorSend(state, 'terminal-1', 'a', sender)
    const pending = queueTerminalLiveMirrorSend(state, 'terminal-1', 'b', sender)

    // When
    cancelTerminalLivePendingFlush(state)

    // Then
    await expect(Promise.all([active, pending])).resolves.toEqual([false, false])
    expect(state.current).toBeNull()
    resolveSend(true)
  })
})
