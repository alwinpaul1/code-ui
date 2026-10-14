// Reported from the phone on 0.9.138 (2026-10-14): "Also all terminals in
// flashes and changes to mobile fix that." The 2026-10-13 report said the same
// of one tab: "Opens in desktop and flashes and changes to mobile."
//
// Leaving a terminal hands it back to the desk with `terminal.setDisplayMode`
// 'desktop' (use-mobile-session-view-switch.ts: tab switch, Back, HOME, the
// route closing, a held floor from a killed run). The host keeps that mode for
// the PTY until it is told 'auto' (orca-runtime `mobileDisplayModes`, which
// only 'auto' or the PTY's exit clears), and a subscribe in 'desktop' mode is a
// passive watch: no phone fit, a desktop-width snapshot, `displayMode:
// 'desktop'`. The view switch asked for 'auto' only from an effect, after the
// render, so the subscribe went out first. Every terminal the phone had ever
// left therefore opened at desktop width and then reflowed to the phone, and
// the first-frame cover lifts on a desktop-mode frame and only covers a pane
// once per screen anyway.
//
// These drive the session's real subscribe path against a host that keeps a
// display mode per PTY the way Orca does.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'
import { useTerminalFirstFrameReveal } from '../terminal/terminal-first-frame-reveal'
import { PHONE_MODE_BEFORE_SUBSCRIBE_TIMEOUT_MS } from './terminal-phone-mode-before-subscribe'

/** The S23's phone viewport. */
const PHONE = { cols: 51, rows: 38 }
/** The desk's PTY. */
const DESKTOP = { cols: 160, rows: 48 }

type StreamEvent = Record<string, unknown>
type Mode = 'auto' | 'desktop'

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
    }
  })
}

/** A host that remembers a display mode per PTY, as Orca's runtime does. */
function fakeHost(initial: Mode) {
  const modes = new Map<string, Mode>()
  const calls: string[] = []
  const live = new Map<string, (event: StreamEvent) => void>()
  return {
    modes,
    calls,
    live,
    seed(handle: string) {
      modes.set(handle, initial)
    },
    subscribe(handle: string, params: { viewport?: { cols: number; rows: number } }, onData: (e: StreamEvent) => void) {
      const mode = modes.get(handle) ?? 'auto'
      calls.push(`subscribe:${mode}:${params.viewport ? 'viewport' : 'none'}`)
      live.set(handle, onData)
      // Answered after the call returns, as a stream frame is.
      const fitted = mode === 'auto' && params.viewport
      const dims = fitted ? PHONE : DESKTOP
      queueMicrotask(() =>
        onData({
          type: 'scrollback',
          cols: dims.cols,
          rows: dims.rows,
          serialized: '❯ ',
          seq: 1,
          displayMode: mode
        })
      )
    },
    /** `terminal.setDisplayMode` 'auto': clears the sticky mode and phone-fits a live subscriber. */
    setAuto(handle: string) {
      calls.push('setDisplayMode:auto')
      modes.set(handle, 'auto')
      const onData = live.get(handle)
      if (onData) {
        onData({ type: 'resized', cols: PHONE.cols, rows: PHONE.rows, displayMode: 'auto', seq: 2 })
      }
    }
  }
}

function harness(
  handle: string,
  options: {
    host: ReturnType<typeof fakeHost>
    claim?: ((h: string) => Promise<boolean>) | null
    covered?: boolean
    wired?: boolean
  }
) {
  const { host } = options
  host.seed(handle)
  const painted: Array<{ cols: number; rows: number; kind: 'init' | 'resize' }> = []
  const client = {
    subscribe: vi.fn((_method: string, params: { terminal: string; viewport?: { cols: number; rows: number } }, onData: (event: StreamEvent) => void) => {
      host.subscribe(params.terminal, params, onData)
      return () => host.live.delete(params.terminal)
    })
  }
  const pane = {
    init: vi.fn((cols: number, rows: number) => {
      painted.push({ cols, rows, kind: 'init' })
    }),
    write: vi.fn(),
    resize: vi.fn((cols: number, rows: number) => {
      painted.push({ cols, rows, kind: 'resize' })
    }),
    resetZoom: vi.fn(),
    awaitReady: vi.fn(async () => {}),
    measureFitDimensions: vi.fn(async () => ({ ...PHONE }))
  }
  const terminalUnsubsRef = { current: new Map<string, () => void>() }
  const subscribingHandlesRef = { current: new Set<string>() }
  const subscribeSeqRef = { current: new Map<string, number>() }
  const unsubscribeTerminal = (h: string) => {
    terminalUnsubsRef.current.get(h)?.()
    terminalUnsubsRef.current.delete(h)
    subscribingHandlesRef.current.delete(h)
    subscribeSeqRef.current.set(h, (subscribeSeqRef.current.get(h) ?? 0) + 1)
  }
  const defaultClaim = async (h: string) => {
    await Promise.resolve()
    host.setAuto(h)
    return true
  }
  const claim = vi.fn(options.claim === undefined ? defaultClaim : (options.claim ?? defaultClaim))
  const phoneModeClaimRef = { current: options.claim === null ? null : claim }
  const phoneModeClaimedHandlesRef = { current: new Set<string>() }
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: { ...PHONE } },
    viewportMeasuredRef: { current: true },
    terminalUnsubsRef,
    subscribingHandlesRef,
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: new Proxy({}, { get: () => () => {} }) },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef: { current: new Set([handle]) },
    activeHandleRef: { current: handle },
    subscribeSeqRef,
    layoutSeqRef: { current: new Map<string, number>() },
    terminalFrameHeightRef: { current: 600 },
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    markNativeChatInputLeaseReady: vi.fn(),
    showNativeChatRef: { current: options.covered === true },
    getTerminalRef: (h: string | null) => (h === handle ? pane : undefined),
    unsubscribeTerminal,
    unsubscribeTerminalRef: { current: unsubscribeTerminal },
    signalTerminalInventoryRecovery: vi.fn(),
    ...(options.wired === false ? {} : { phoneModeClaimRef, phoneModeClaimedHandlesRef })
  }
  let subscribeToTerminal: (h: string) => void = () => {}
  function Harness() {
    const reveal = useTerminalFirstFrameReveal()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member the hook reads.
    subscribeToTerminal = useMobileSessionTerminalSubscription({ ...scope, ...reveal } as never).subscribeToTerminal
    return null
  }
  act(() => {
    create(createElement(Harness))
  })
  return {
    client,
    claim,
    pane,
    painted,
    phoneModeClaimedHandlesRef,
    subscribe: () => act(() => subscribeToTerminal(handle)),
    leave: () => act(() => unsubscribeTerminal(handle)),
    resubscribe: () =>
      act(() => {
        unsubscribeTerminal(handle)
        scope.initializedHandlesRef.current.delete(handle)
        subscribeToTerminal(handle)
      })
  }
}

describe('a terminal the phone handed back to the desk reopens at phone width', () => {
  let logs: unknown[][]
  beforeEach(() => {
    vi.useFakeTimers()
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args)
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('never paints the desktop width first: phone mode is asked for before the subscribe', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host })
    h.subscribe()
    await flush()
    expect(host.calls).toEqual(['setDisplayMode:auto', 'subscribe:auto:viewport'])
    expect(h.painted[0]).toEqual({ cols: PHONE.cols, rows: PHONE.rows, kind: 'init' })
    expect(h.painted.some((p) => p.cols === DESKTOP.cols)).toBe(false)
  })

  it('asks once per visit, not once per re-subscribe (a manual desktop pick survives the fit pass)', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host })
    h.subscribe()
    await flush()
    h.resubscribe()
    await flush()
    h.resubscribe()
    await flush()
    expect(h.claim).toHaveBeenCalledTimes(1)
    expect(h.client.subscribe).toHaveBeenCalledTimes(3)
  })

  it('asks again on the next visit once the claim was handed back', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host })
    h.subscribe()
    await flush()
    h.leave()
    // The view switch hands it back and forgets the claim (use-mobile-session-view-switch.ts).
    host.modes.set('pty-1', 'desktop')
    h.phoneModeClaimedHandlesRef.current.delete('pty-1')
    h.subscribe()
    await flush()
    expect(h.claim).toHaveBeenCalledTimes(2)
    expect(host.calls.at(-1)).toBe('subscribe:auto:viewport')
  })

  it('does not phone-fit a terminal the user left while the claim was out', async () => {
    const host = fakeHost('desktop')
    let answer!: (accepted: boolean) => void
    const h = harness('pty-1', {
      host,
      claim: () => new Promise<boolean>((resolve) => {
        answer = resolve
      })
    })
    h.subscribe()
    h.leave()
    answer(true)
    await flush()
    expect(h.client.subscribe).not.toHaveBeenCalled()
  })

  it('a hand-back while the claim is out leaves the terminal unclaimed, so the next visit asks again', async () => {
    // The host answers at phone size, so no fit pass re-subscribes (and re-claims) here.
    const host = fakeHost('auto')
    let answer!: (accepted: boolean) => void
    const h = harness('pty-1', {
      host,
      claim: () => new Promise<boolean>((resolve) => {
        answer = resolve
      })
    })
    h.subscribe()
    // HOME inside one round trip: the view switch hands it back and forgets the claim.
    h.phoneModeClaimedHandlesRef.current.delete('pty-1')
    answer(true)
    await flush()
    expect(h.phoneModeClaimedHandlesRef.current.has('pty-1')).toBe(false)
  })

  it('a second subscribe while the claim is out sends one claim and one subscribe', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host })
    h.subscribe()
    h.subscribe()
    await flush()
    expect(h.claim).toHaveBeenCalledTimes(1)
    expect(h.client.subscribe).toHaveBeenCalledTimes(1)
  })

  it('never asks for phone mode on a terminal chat is covering (it is not drawn on the phone)', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host, covered: true })
    h.subscribe()
    await flush()
    expect(h.claim).not.toHaveBeenCalled()
    expect(host.calls).toEqual(['subscribe:desktop:none'])
  })

  it('failure: a refused claim still subscribes, and says why the frame may be desktop-width', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host, claim: async () => false })
    h.subscribe()
    await flush()
    // The host stayed in desktop mode, so the fit pass re-subscribes for a phone-size frame;
    // neither it nor the first subscribe sends a second claim.
    expect(h.client.subscribe).toHaveBeenCalled()
    expect(h.claim).toHaveBeenCalledTimes(1)
    expect(h.pane.init).toHaveBeenCalled()
    expect(logs.some((line) => String(line[0]).includes('phone mode not confirmed') && JSON.stringify(line[1]).includes('refused'))).toBe(true)
  })

  it('failure: a rejected claim still subscribes', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', {
      host,
      claim: async () => {
        throw new Error('socket closed')
      }
    })
    h.subscribe()
    await flush()
    expect(h.client.subscribe).toHaveBeenCalled()
    expect(h.pane.init).toHaveBeenCalled()
  })

  it('failure: a claim the host never answers subscribes after the timeout, not never', async () => {
    const host = fakeHost('desktop')
    const h = harness('pty-1', { host, claim: () => new Promise<boolean>(() => {}) })
    h.subscribe()
    await flush()
    expect(h.client.subscribe).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(PHONE_MODE_BEFORE_SUBSCRIBE_TIMEOUT_MS)
    })
    await flush()
    expect(h.client.subscribe).toHaveBeenCalled()
    expect(h.claim).toHaveBeenCalledTimes(1)
    expect(logs.some((line) => JSON.stringify(line[1]).includes('timeout'))).toBe(true)
  })

  it('degenerate: with no claim wired (a scope without the view switch) the subscribe goes straight out', async () => {
    const host = fakeHost('auto')
    const h = harness('pty-1', { host, wired: false })
    h.subscribe()
    await flush()
    expect(host.calls).toEqual(['subscribe:auto:viewport'])
  })
})
