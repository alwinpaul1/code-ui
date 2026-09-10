import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { useMobileSessionViewSwitch } from './use-mobile-session-view-switch'
import type { MobileSessionPanelRouteActionsModel } from './use-mobile-session-panel-route-actions'

/** The phone claims the host's presence floor by asking for 'auto' (phone
 *  dims) as a mobile client. That is what puts "Your phone is in control /
 *  Desktop keyboard is paused" on the desktop. Nothing handed it back when the
 *  route went away, so the desk stayed locked until someone clicked
 *  "Take back this terminal". */
function mountViewSwitch(activeHandle: string | null) {
  const setDisplayMode = vi.fn(async () => true)
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
