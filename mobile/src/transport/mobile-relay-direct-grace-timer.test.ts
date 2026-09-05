import { describe, expect, it, vi } from 'vitest'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import {
  DIRECT_DIAL_GRACE_MS,
  MobileRelayDirectGraceTimer
} from './mobile-relay-direct-grace-timer'

function logicalIn(state: string) {
  return { getState: () => state } as unknown as StableLogicalRpcClient
}

describe('MobileRelayDirectGraceTimer', () => {
  it('gives a fresh direct dial its 2.5s head start', () => {
    const setTimer = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const timer = new MobileRelayDirectGraceTimer(
      { setTimer: setTimer as never, clearTimer: vi.fn() },
      logicalIn('connecting'),
      vi.fn()
    )
    timer.arm()
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), DIRECT_DIAL_GRACE_MS)
  })

  it('races the relay at once when the endpoint is known unreachable', () => {
    const setTimer = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const timer = new MobileRelayDirectGraceTimer(
      { setTimer: setTimer as never, clearTimer: vi.fn() },
      logicalIn('connecting'),
      vi.fn(),
      () => 0
    )
    timer.arm()
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 0)
  })

  it('does nothing when direct is already connected', () => {
    const setTimer = vi.fn()
    new MobileRelayDirectGraceTimer(
      { setTimer: setTimer as never, clearTimer: vi.fn() },
      logicalIn('connected'),
      vi.fn(),
      () => 0
    ).arm()
    expect(setTimer).not.toHaveBeenCalled()
  })
})
