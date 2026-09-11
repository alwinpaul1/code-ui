import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook listens for the app leaving and re-entering the foreground. The
// real module is Flow-typed and unparseable here, so this stands in for it and
// lets a case drive the transitions the device actually produces.
const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>()
  return {
    current: 'active',
    listeners,
    go(state: string) {
      this.current = state
      for (const listener of listeners) {
        listener(state)
      }
    }
  }
})
const heldFloors = vi.hoisted(() => ({
  readHeldFloors: vi.fn(async (): Promise<string[]> => []),
  rememberHeldFloor: vi.fn(async () => undefined),
  forgetHeldFloor: vi.fn(async () => undefined)
}))
vi.mock('./mobile-held-floor-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-held-floor-store')>()),
  ...heldFloors
}))

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.current
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener)
      return { remove: () => appState.listeners.delete(listener) }
    }
  }
}))

beforeEach(() => {
  appState.listeners.clear()
  appState.current = 'active'
  heldFloors.readHeldFloors.mockResolvedValue([])
  heldFloors.rememberHeldFloor.mockClear()
  heldFloors.forgetHeldFloor.mockClear()
})

import { useMobileSessionViewSwitch } from './use-mobile-session-view-switch'
import type { MobileSessionPanelRouteActionsModel } from './use-mobile-session-panel-route-actions'

/** The phone claims the host's presence floor by asking for 'auto' (phone
 *  dims) as a mobile client. That is what puts "Your phone is in control /
 *  Desktop keyboard is paused" on the desktop. Nothing handed it back when the
 *  route went away, so the desk stayed locked until someone clicked
 *  "Take back this terminal". */
function mountViewSwitch(
  activeHandle: string | null,
  setDisplayMode: ReturnType<typeof vi.fn> = vi.fn(async () => true)
) {
  const scope = {
    activeHandle,
    sessionTabs: [
      {
        type: 'terminal' as const,
        id: 'tab-1::leaf-1',
        parentTabId: 'tab-1',
        leafId: 'leaf-1',
        title: 'zsh',
        terminal: activeHandle,
        isActive: true
      }
    ],
    setDisplayMode,
    nativeChatController: {
      isTabChatView: () => false,
      toggleTabChatView: vi.fn(),
      // The terminal is on screen, so the PTY runs at phone width.
      showNativeChat: false
    }
  } as unknown as MobileSessionPanelRouteActionsModel

  function Probe() {
    useMobileSessionViewSwitch(scope)
    return null
  }

  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe))
  })
  return {
    setDisplayMode,
    unmount() {
      act(() => {
        renderer.unmount()
      })
    }
  }
}

describe('leaving a session', () => {
  it('drives the visible terminal at phone width while the route is open', () => {
    const probe = mountViewSwitch('term-1')

    expect(probe.setDisplayMode).toHaveBeenCalledWith('term-1', 'auto')
  })

  it('hands the terminal back to desktop width, so the desk keyboard resumes', () => {
    const probe = mountViewSwitch('term-1')
    probe.setDisplayMode.mockClear()

    probe.unmount()

    expect(probe.setDisplayMode).toHaveBeenCalledWith('term-1', 'desktop')
  })

  it('has nothing to hand back when no terminal was driven', () => {
    const probe = mountViewSwitch(null)
    probe.setDisplayMode.mockClear()

    probe.unmount()

    expect(probe.setDisplayMode).not.toHaveBeenCalled()
  })
})

describe('the app going away and coming back', () => {
  it('takes phone width back when the app returns to the foreground', () => {
    const probe = mountViewSwitch('term-1')

    act(() => {
      appState.go('background')
    })
    probe.setDisplayMode.mockClear()
    act(() => {
      appState.go('active')
    })

    expect(probe.setDisplayMode).toHaveBeenCalledWith('term-1', 'auto')
  })

  it('still hands the desk its floor back on the way out after coming back', () => {
    const probe = mountViewSwitch('term-1')
    act(() => {
      appState.go('background')
    })
    act(() => {
      appState.go('active')
    })
    probe.setDisplayMode.mockClear()

    probe.unmount()

    expect(probe.setDisplayMode).toHaveBeenCalledWith('term-1', 'desktop')
  })
})

describe('leaving the route while the relay is unhappy', () => {
  /** Reported on a Galaxy S23: in terminal mode, the hardware back key leaves
   *  the session entirely — the app lands on its own Home screen with no
   *  terminal on screen — and the desk stays at COLS=51 with its keyboard
   *  paused. Nothing recovers it afterwards, because the handle is gone from
   *  the driven set, so no later gesture releases it either. */
  it('keeps asking for the desk floor back when the first request is refused', async () => {
    vi.useFakeTimers()
    try {
      const setDisplayMode = vi.fn(async () => false)
      const probe = mountViewSwitch('term-1', setDisplayMode)
      setDisplayMode.mockClear()

      probe.unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      const desktopCalls = setDisplayMode.mock.calls.filter((call) => call[1] === 'desktop')
      expect(desktopCalls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a floor the app died holding', () => {
  /** Measured on a Galaxy S23: force-stopping the app while it drove a
   *  terminal left the desk at COLS=51, and it was still there 60 s after the
   *  process was confirmed dead. The host never hands it back on its own. */
  it('is handed back the next time the app runs', async () => {
    heldFloors.readHeldFloors.mockResolvedValue(['term-dead'])
    const setDisplayMode = vi.fn(async () => true)

    mountViewSwitch('term-1', setDisplayMode)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setDisplayMode).toHaveBeenCalledWith('term-dead', 'desktop')
  })

  it('does not hand back the terminal the phone is driving right now', async () => {
    heldFloors.readHeldFloors.mockResolvedValue(['term-1'])
    const setDisplayMode = vi.fn(async () => true)

    mountViewSwitch('term-1', setDisplayMode)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setDisplayMode).not.toHaveBeenCalledWith('term-1', 'desktop')
  })

  it('writes down a floor as soon as the phone takes it', () => {
    mountViewSwitch('term-1')

    expect(heldFloors.rememberHeldFloor).toHaveBeenCalledWith('term-1')
  })
})
