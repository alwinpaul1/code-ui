import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// React Native's BackHandler, as it dispatches: the newest listener is asked first, and the first
// one that returns true ends the press (`BackHandler.android.js`). The order is the whole subject
// here, so the mock keeps an array rather than a set and walks it from the end.
const back = vi.hoisted(() => {
  const listeners: (() => boolean)[] = []
  return {
    listeners,
    press(): boolean {
      for (let i = listeners.length - 1; i >= 0; i -= 1) {
        if (listeners[i]!()) {
          return true
        }
      }
      return false
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
  Platform: { OS: 'android' },
  BackHandler: {
    addEventListener: (_event: string, listener: () => boolean) => {
      back.listeners.push(listener)
      return {
        remove: () => {
          const at = back.listeners.indexOf(listener)
          if (at !== -1) {
            back.listeners.splice(at, 1)
          }
        }
      }
    }
  },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} })
  }
}))

import { useMobileSessionViewSwitch } from './use-mobile-session-view-switch'
import { useMobileFilePreviewBack, type MobileFilePreviewBack } from '../files/use-mobile-file-preview-back'
import { useBackClaim } from '../navigation/use-back-claim'
import type { MobileSessionPanelRouteActionsModel } from './use-mobile-session-panel-route-actions'

type SessionState = { title: string; showNativeChat: boolean }

const calls = {
  requestLeaveSession: vi.fn(),
  toggleTabChatView: vi.fn(),
  setDisplayMode: vi.fn(async () => true)
}

/** A fresh scope per render, the way the session builds one: a tab snapshot is a new array and
 *  every callback that reads it is rebuilt with it. */
function scopeFor(state: SessionState): MobileSessionPanelRouteActionsModel {
  const scope = {
    activeHandle: 'term-1',
    activeSessionTabId: 'tab-1::leaf-1',
    sessionTabs: [
      {
        type: 'terminal' as const,
        id: 'tab-1::leaf-1',
        parentTabId: 'tab-1',
        leafId: 'leaf-1',
        title: state.title,
        terminal: 'term-1',
        isActive: true
      }
    ],
    setDisplayMode: calls.setDisplayMode,
    requestLeaveSession: () => calls.requestLeaveSession(),
    nativeChatController: {
      isTabChatView: () => state.showNativeChat,
      toggleTabChatView: (...args: unknown[]) => calls.toggleTabChatView(...args),
      showNativeChat: state.showNativeChat,
      activeChatEligible: true
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only the fields above (its destructuring at the top); any other member is undefined and a TypeError here.
  return scope as unknown as MobileSessionPanelRouteActionsModel
}

function Session({ state }: { state: SessionState }): null {
  useMobileSessionViewSwitch(scopeFor(state))
  return null
}

const preview: { back: MobileFilePreviewBack | null; leave: ReturnType<typeof vi.fn> } = {
  back: null,
  leave: vi.fn()
}

function FilePreview({ hasUnsavedDraft }: { hasUnsavedDraft: boolean }): null {
  preview.back = useMobileFilePreviewBack({ hasUnsavedDraft, leave: preview.leave })
  return null
}

const drawer = { onClose: vi.fn() }

/** The diff review's PR drawer claims the key exactly this way (`RightDrawer.tsx`). */
function PrDrawer({ visible }: { visible: boolean }): null {
  useBackClaim(
    visible
      ? () => {
          drawer.onClose()
          return true
        }
      : null
  )
  return null
}

type Pushed = { kind: 'none' } | { kind: 'preview'; dirty: boolean } | { kind: 'drawer'; visible: boolean }

/** The session stays mounted and keeps re-rendering under a route pushed over it: expo-router's
 *  stack is not frozen here (nothing calls `enableFreeze`). */
function Stack({ session, pushed }: { session: SessionState; pushed: Pushed }) {
  return createElement(
    Fragment,
    null,
    createElement(Session, { state: session }),
    pushed.kind === 'preview' ? createElement(FilePreview, { hasUnsavedDraft: pushed.dirty }) : null,
    pushed.kind === 'drawer' ? createElement(PrDrawer, { visible: pushed.visible }) : null
  )
}

function mount(session: SessionState, pushed: Pushed) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Stack, { session, pushed }))
  })
  return {
    update(nextSession: SessionState, nextPushed: Pushed) {
      act(() => {
        renderer.update(createElement(Stack, { session: nextSession, pushed: nextPushed }))
      })
    },
    unmount() {
      act(() => {
        renderer.unmount()
      })
    }
  }
}

function pressBack(): boolean {
  let handled = false
  act(() => {
    handled = back.press()
  })
  return handled
}

beforeEach(() => {
  back.listeners.length = 0
  calls.requestLeaveSession.mockClear()
  calls.toggleTabChatView.mockClear()
  calls.setDisplayMode.mockClear()
  preview.back = null
  preview.leave.mockClear()
  drawer.onClose.mockClear()
})

// Reported by the v1.4.211 port's review, 2026-09-25. #22308 moved the preview and the PR drawer
// onto `useBackClaim`, which registers once per claim. The session's own Back re-registered on
// every tab snapshot, so it climbed back above them and answered a Back meant for the screen on
// top: the preview popped with its edit and no prompt, or the hidden session flipped to chat.
describe("Back on a screen pushed over a session the agent is still updating", () => {
  it('asks about the file preview’s unsaved draft, not the session underneath', () => {
    const stack = mount({ title: 'claude', showNativeChat: false }, { kind: 'preview', dirty: false })
    stack.update({ title: 'claude · working', showNativeChat: false }, { kind: 'preview', dirty: false })
    stack.update({ title: 'claude · working', showNativeChat: false }, { kind: 'preview', dirty: true })

    expect(pressBack()).toBe(true)

    expect(preview.back?.confirmingDiscard).toBe(true)
    expect(preview.leave).not.toHaveBeenCalled()
    expect(calls.requestLeaveSession).not.toHaveBeenCalled()
    expect(calls.toggleTabChatView).not.toHaveBeenCalled()
    stack.unmount()
  })

  it('asks about a draft made before the snapshot arrived, too', () => {
    const stack = mount({ title: 'claude', showNativeChat: false }, { kind: 'preview', dirty: true })
    stack.update({ title: 'claude · working', showNativeChat: false }, { kind: 'preview', dirty: true })

    pressBack()

    expect(preview.back?.confirmingDiscard).toBe(true)
    expect(calls.requestLeaveSession).not.toHaveBeenCalled()
    expect(calls.toggleTabChatView).not.toHaveBeenCalled()
    stack.unmount()
  })

  it('closes the diff review’s PR drawer, not the session underneath', () => {
    const stack = mount({ title: 'claude', showNativeChat: false }, { kind: 'drawer', visible: true })
    stack.update({ title: 'claude · working', showNativeChat: false }, { kind: 'drawer', visible: true })

    pressBack()

    expect(drawer.onClose).toHaveBeenCalledTimes(1)
    expect(calls.requestLeaveSession).not.toHaveBeenCalled()
    expect(calls.toggleTabChatView).not.toHaveBeenCalled()
    stack.unmount()
  })
})

describe("the session's own Back once nothing is on top of it", () => {
  it('comes back to the session when the pushed screen goes', () => {
    const stack = mount({ title: 'claude', showNativeChat: true }, { kind: 'preview', dirty: true })
    stack.update({ title: 'claude', showNativeChat: true }, { kind: 'none' })

    pressBack()

    expect(calls.requestLeaveSession).toHaveBeenCalledTimes(1)
    stack.unmount()
  })

  it('answers from the state of its latest render, not the one it registered on', () => {
    // Terminal view of a chat-eligible tab: Back shows the chat. Then the chat is showing, and
    // Back leaves. A handler registered once must still read the second render.
    const stack = mount({ title: 'claude', showNativeChat: false }, { kind: 'none' })
    pressBack()
    expect(calls.toggleTabChatView).toHaveBeenCalledTimes(1)
    expect(calls.requestLeaveSession).not.toHaveBeenCalled()

    stack.update({ title: 'claude · working', showNativeChat: true }, { kind: 'none' })
    pressBack()

    expect(calls.toggleTabChatView).toHaveBeenCalledTimes(1)
    expect(calls.requestLeaveSession).toHaveBeenCalledTimes(1)
    stack.unmount()
  })

  it('holds one registration, whatever the snapshots do', () => {
    const stack = mount({ title: 'a', showNativeChat: false }, { kind: 'none' })
    stack.update({ title: 'b', showNativeChat: false }, { kind: 'none' })
    stack.update({ title: 'c', showNativeChat: true }, { kind: 'none' })
    expect(back.listeners).toHaveLength(1)

    stack.unmount()

    expect(back.listeners).toHaveLength(0)
    expect(pressBack()).toBe(false)
  })
})
