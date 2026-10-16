import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ForceReconnect } from '../transport/rpc-client-context-contract'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
// The paired desktop's name, from the host store (which needs the native secure store).
const hostName = vi.hoisted(() => ({ current: null as string | null }))
vi.mock('./use-session-host-name', () => ({ useSessionHostName: () => hostName.current }))

import { useMobileSessionPresentation } from './use-mobile-session-presentation'

type Presentation = ReturnType<typeof useMobileSessionPresentation>

/** A session whose host the shell's client has failed to reach twenty times. */
function present(forceReconnectHost: ForceReconnect, overrides: Record<string, unknown> = {}): Presentation {
  const scope = {
    hostId: 'host-1',
    created: undefined,
    worktreeId: 'wt-1',
    router: { setParams: () => {} },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    connState: 'reconnecting',
    client: null,
    reconnectAttempts: 20,
    lastConnectedAt: null,
    terminalsLoaded: false,
    activeHandle: null,
    creating: false,
    creatingBrowser: false,
    creatingMarkdown: false,
    keyboardHeight: 0,
    terminalKeyboardMetrics: new Map(),
    toastOpacityRef: { current: 1 },
    hostEndpoint: null,
    initialSessionAutoCreateRef: { current: null },
    terminalFrameHeightRef: { current: 0 },
    handleCreateTerminal: () => Promise.resolve(),
    visibleTabs: [],
    forceReconnectHost,
    ...overrides
  }
  type Scope = Parameters<typeof useMobileSessionPresentation>[0]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the presentation hook reads only these members of the session scope; the rest of the controller is unreachable from it.
  const sessionScope = scope as unknown as Scope
  const read: { value: Presentation | null } = { value: null }
  function Probe(): null {
    read.value = useMobileSessionPresentation(sessionScope)
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  if (read.value === null) {
    throw new Error('the hook did not run')
  }
  return read.value
}

describe("the session header's tap to retry", () => {
  it('is not offered on the page, and the status says what is wrong without promising a tap', () => {
    const { showConnectionRetry, terminalSummary } = present(null)
    expect({ showConnectionRetry, terminalSummary }).toEqual({
      showConnectionRetry: false,
      terminalSummary: "Can't reach desktop"
    })
  })

  it('is still offered natively', () => {
    const { showConnectionRetry, terminalSummary } = present(() => Promise.resolve())
    expect({ showConnectionRetry, terminalSummary }).toEqual({
      showConnectionRetry: true,
      terminalSummary: "Can't reach desktop — tap to retry"
    })
  })
})

// 2026-10-16, from the user: a session still waiting on a desktop that never answers loaded
// forever (Clawd and "Loading session…" in the chat; an empty frame for a workspace never cached).
// The header's own verdict goes to the loading screens, which say it in place of loading.
describe("the session's loading screens while the host cannot be reached", () => {
  it("hand the header's verdict to the loading screens, naming the desktop and where to look", () => {
    hostName.current = 'Studio'
    const forceReconnect = vi.fn(() => Promise.resolve())
    const { loadingConnectionTroubleState } = present(forceReconnect)
    expect(loadingConnectionTroubleState?.trouble).toEqual({
      label: "Can't reach desktop",
      detail: 'Studio isn’t reachable right now. Check it’s awake and Orca is running; this screen reconnects on its own.',
      retryable: true
    })
    loadingConnectionTroubleState?.onRetry?.()
    expect(forceReconnect).toHaveBeenCalledWith('host-1')
    hostName.current = null
  })

  it('offer no Retry on the page, where the shell owns the connection', () => {
    const { loadingConnectionTroubleState } = present(null)
    expect(loadingConnectionTroubleState?.trouble.label).toBe("Can't reach desktop")
    expect(loadingConnectionTroubleState?.onRetry).toBeNull()
  })

  it('clear by themselves once the host connects', () => {
    const { loadingConnectionTroubleState } = present(() => Promise.resolve(), {
      connState: 'connected',
      reconnectAttempts: 0,
      lastConnectedAt: 1
    })
    expect(loadingConnectionTroubleState).toBeNull()
  })

  it('draw a loading screen, not an empty frame, before the first connection of a workspace never cached', () => {
    expect(present(null).sessionLoadingScreen).toBe('plain')
    expect(present(null, { routeAgentParam: 'claude' }).sessionLoadingScreen).toBe('claude')
    expect(present(null, { routeAgentParam: 'codex' }).sessionLoadingScreen).toBe('plain')
  })
})
