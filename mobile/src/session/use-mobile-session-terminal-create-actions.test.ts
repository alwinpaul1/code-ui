import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileSessionTerminalCreateActions } from './use-mobile-session-terminal-create-actions'
import { SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'

type PlacementTab = { id: string; parentTabId?: string }
type PlacementUpdater = (previous: PlacementTab[]) => PlacementTab[]

vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn()
}))

function clientReturning(...responses: unknown[]): RpcClient {
  let responseIndex = 0
  return {
    sendRequest: vi.fn(async () => responses[responseIndex++])
  } as unknown as RpcClient
}

function terminalCreateResponse() {
  return {
    ok: true,
    result: {
      tab: {
        type: 'terminal',
        id: 'terminal-tab-1',
        title: 'Codex',
        terminal: 'terminal-1',
        isActive: true
      }
    }
  }
}

/** Answers by method name, because the terminal path also asks the host for its
 *  launch defaults (settings.get, status.get) before creating anything. */
function clientAnswering(byMethod: Record<string, unknown>): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string) => {
      const answer = byMethod[method]
      if (answer === undefined) {
        throw new Error(`unexpected method ${method}`)
      }
      return typeof answer === 'function' ? (answer as () => unknown)() : answer
    })
  } as unknown as RpcClient
}

function createScope(client: RpcClient) {
  return {
    worktreeId: 'workspace-1',
    client,
    hostCapabilities: [],
    connState: 'connected',
    setTerminals: vi.fn(),
    terminalsRef: { current: [] },
    setSessionTabs: vi.fn<(updater: PlacementUpdater) => void>(),
    defaultTerminalHandlesToLiveInput: vi.fn(),
    setActiveHandle: vi.fn(),
    activeSessionTabId: 'existing-tab',
    activeSessionTabIdRef: { current: 'existing-tab' },
    setActiveSessionTabId: vi.fn(),
    setCreating: vi.fn(),
    creatingTerminalRef: { current: false },
    creatingBrowser: false,
    creatingMarkdown: false,
    setCreateError: vi.fn(),
    deviceTokenRef: { current: null },
    initializedHandlesRef: { current: new Set<string>() },
    activeHandleRef: { current: 'existing-terminal' },
    activeSessionTabTypeRef: { current: 'terminal' },
    pendingActiveSessionTabIdRef: { current: null },
    pendingActiveTerminalHandleRef: { current: null },
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    unsubscribeTerminal: vi.fn(),
    subscribeToTerminal: vi.fn(),
    fetchSessionTabs: vi.fn(async () => {})
  }
}

describe('mobile + Codex tab creation routing', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => renderer?.unmount())

  it('uses the structured agent-session path for a bare Codex launch', async () => {
    const client = clientReturning(
      { ok: true, result: { supported: true } },
      {
        ok: true,
        result: {
          ok: true,
          value: { sessionId: 'codex_session_1' }
        }
      }
    )
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(client.sendRequest).toHaveBeenNthCalledWith(1, 'agentSession.createSupport', {
      worktree: 'id:workspace-1',
      agent: 'codex'
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(
      2,
      'agentSession.create',
      expect.objectContaining({ worktree: 'id:workspace-1', agent: 'codex' }),
      expect.anything()
    )
    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.anything()
    )
    expect(scope.setActiveSessionTabId).toHaveBeenCalledWith('agent-session:codex_session_1')
    expect(scope.setActiveHandle).toHaveBeenCalledWith(null)
    expect(scope.unsubscribeTerminal).toHaveBeenCalledWith('existing-terminal')
  })

  it('reports unavailable structured support without launching a terminal', async () => {
    const client = clientReturning(
      { ok: false, error: { code: 'structured_agent_session_unsupported', message: 'off' } },
      terminalCreateResponse()
    )
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(scope.setCreateError).toHaveBeenCalledWith(
      'This Orca host cannot open a Codex server session. Check that the host supports Codex chat and try again.'
    )
    expect(scope.setActiveSessionTabId).not.toHaveBeenCalled()
  })

  it('reports a refused structured creation without launching a terminal', async () => {
    const client = clientReturning(
      { ok: true, result: { supported: true } },
      {
        ok: true,
        result: {
          ok: false,
          refusal: { code: 'agent_session_ownership_unknown', message: 'provider unavailable' }
        }
      },
      terminalCreateResponse()
    )
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(client.sendRequest).toHaveBeenCalledTimes(2)
    expect(scope.setCreateError).toHaveBeenCalledWith('provider unavailable')
    expect(scope.setActiveSessionTabId).not.toHaveBeenCalled()
  })

  it('keeps prompted Codex launches on the legacy terminal path', async () => {
    const client = clientReturning(terminalCreateResponse(), {
      ok: true,
      result: { send: { accepted: true } }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex', { initialPrompt: 'Inspect this diff' })
    })

    expect(client.sendRequest).toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.objectContaining({ agent: 'codex' })
    )
    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'agentSession.createSupport',
      expect.anything()
    )
  })

  it('does not create a legacy sibling after an unknown structured outcome', async () => {
    const client = clientReturning({ ok: true, result: { supported: true } })
    const sendRequest = client.sendRequest as unknown as ReturnType<typeof vi.fn>
    sendRequest.mockImplementationOnce(async () => ({
      ok: true,
      result: { supported: true }
    }))
    sendRequest.mockRejectedValueOnce(markRpcDeliveryUnknown(new Error('response lost')))
    sendRequest.mockRejectedValueOnce(markRpcDeliveryUnknown(new Error('still unknown')))
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'agentSession.createSupport',
      'agentSession.create',
      'agentSession.create'
    ])
    expect(scope.setCreateError).toHaveBeenCalledWith('still unknown')
    expect(scope.showToast).toHaveBeenCalledWith('still unknown', 1800)
  })
  it('opens a structured chat for a bare Claude launch instead of a terminal', async () => {
    const client = clientAnswering({
      'agentSession.createSupport': { ok: true, result: { supported: true } },
      'agentSession.create': { ok: true, result: { ok: true, value: { sessionId: 'claude_s1' } } }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('claude')
    })

    expect(client.sendRequest).toHaveBeenNthCalledWith(1, 'agentSession.createSupport', {
      worktree: 'id:workspace-1',
      agent: 'claude'
    })
    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.anything()
    )
    expect(scope.setActiveSessionTabId).toHaveBeenCalledWith('agent-session:claude_s1')
  })

  it('a Claude launch the host cannot support still opens a terminal, with its HUD beacon flags', async () => {
    const client = clientAnswering({
      'agentSession.createSupport': { ok: true, result: { supported: false } },
      'settings.get': { ok: true, result: {} },
      'status.get': { ok: true, result: { platform: 'darwin' } },
      'session.tabs.createTerminal': terminalCreateResponse()
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('claude')
    })

    const createCall = (
      client.sendRequest as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(([method]) => method === 'session.tabs.createTerminal')
    expect(createCall).toBeDefined()
    const createParams = createCall?.[1] as
      | { agent?: string; launchConfig?: { agentArgs?: unknown } }
      | undefined
    expect(createParams).toMatchObject({ agent: 'claude' })
    expect(createParams?.launchConfig?.agentArgs).toBeTruthy()
    expect(scope.setCreateError).not.toHaveBeenCalledWith(expect.stringContaining('Codex'))
    expect(scope.setActiveSessionTabId).toHaveBeenCalledWith('terminal-tab-1')
  })

  it('a Codex launch the host cannot support still refuses instead of opening a terminal', async () => {
    const client = clientAnswering({
      'agentSession.createSupport': { ok: true, result: { supported: false } }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.anything()
    )
    expect(scope.setCreateError).toHaveBeenCalledWith(
      'This Orca host cannot open a Codex server session. Check that the host supports Codex chat and try again.'
    )
    expect(scope.setActiveSessionTabId).not.toHaveBeenCalled()
  })

  it('an unconfirmed Claude create never opens a sibling terminal', async () => {
    const client = clientAnswering({
      'agentSession.createSupport': { ok: true, result: { supported: true } },
      'agentSession.create': {
        ok: false,
        error: { code: 'agent_session_operation_unknown', message: 'create outcome ambiguous' }
      }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('claude')
    })

    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.anything()
    )
    expect(scope.setCreateError).toHaveBeenCalledWith('create outcome ambiguous')
  })
  it.each(['structured_agent_session_unsupported', 'method_not_found'])(
    'a Claude create the host definitively refuses with %s still opens a terminal',
    async (code) => {
      const client = clientAnswering({
        'agentSession.createSupport': { ok: true, result: { supported: true } },
        'agentSession.create': { ok: false, error: { code, message: 'no structured lane' } },
        'settings.get': { ok: true, result: {} },
        'status.get': { ok: true, result: { platform: 'darwin' } },
        'session.tabs.createTerminal': terminalCreateResponse()
      })
      const scope = createScope(client)
      let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
      function Harness() {
        actions = useMobileSessionTerminalCreateActions(scope as never)
        return null
      }
      await act(async () => {
        renderer = create(createElement(Harness))
      })
      await act(async () => {
        await actions?.handleCreateTerminal('claude')
      })

      const createCall = (
        client.sendRequest as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.find(([method]) => method === 'session.tabs.createTerminal')
      const createParams = createCall?.[1] as
        | { agent?: string; launchConfig?: { agentArgs?: unknown } }
        | undefined
      expect(createParams).toMatchObject({ agent: 'claude' })
      expect(createParams?.launchConfig?.agentArgs).toBeTruthy()
      expect(scope.setActiveSessionTabId).toHaveBeenCalledWith('terminal-tab-1')
    }
  )

  it('a Codex create the host definitively refuses still opens nothing', async () => {
    const client = clientAnswering({
      'agentSession.createSupport': { ok: true, result: { supported: true } },
      'agentSession.create': {
        ok: false,
        error: { code: 'structured_agent_session_unsupported', message: 'no structured lane' }
      }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal('codex')
    })

    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.anything()
    )
    expect(scope.setCreateError).toHaveBeenCalledWith('no structured lane')
  })

  // Why: pty exhaustion, a disabled agent and an unresolved worktree owner all arrived as the
  // same 'Failed to create terminal', leaving the empty session with nothing to act on.
  it('surfaces the host reason instead of a generic terminal-create error', async () => {
    const client = clientReturning({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'Your system cannot allocate any more pty devices.'
      }
    })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal()
    })

    expect(scope.setCreateError).toHaveBeenCalledWith(
      'Your system cannot allocate any more pty devices.'
    )
  })

  it('falls back to the generic message when the host gives no reason', async () => {
    const client = clientReturning({ ok: false, error: { code: 'runtime_error', message: '' } })
    const scope = createScope(client)
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal()
    })

    expect(scope.setCreateError).toHaveBeenCalledWith('Failed to create terminal')
  })
})

describe('optimistic placement of a created tab', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => renderer?.unmount())

  async function createTerminal(scope: ReturnType<typeof createScope>) {
    let actions: ReturnType<typeof useMobileSessionTerminalCreateActions> | undefined
    function Harness() {
      actions = useMobileSessionTerminalCreateActions(scope as never)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await actions?.handleCreateTerminal()
    })
  }

  function tabIdsAfterCreate(
    scope: ReturnType<typeof createScope>,
    prior: PlacementTab[]
  ): string[] {
    const updater = scope.setSessionTabs.mock.calls.at(-1)?.[0]
    if (!updater) {
      throw new Error('Expected a session tab updater')
    }
    return updater(prior).map((tab) => tab.id)
  }

  it('paints the created tab after the anchor it asked the host for, not at the end', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.hostCapabilities = [SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY]
    await createTerminal(scope)

    expect(scope.setSessionTabs).toHaveBeenCalled()
    // The request anchored on the active tab, so the paint must land in the same slot the host
    // splices into; appending here is what made the tab jump on the next snapshot.
    expect(tabIdsAfterCreate(scope, [{ id: 'existing-tab' }, { id: 'trailing-tab' }])).toEqual([
      'existing-tab',
      'terminal-tab-1',
      'trailing-tab'
    ])
  })

  it('paints after the active split parent, matching headed host placement', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.hostCapabilities = [SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY]
    scope.activeSessionTabId = 'existing-tab::left'
    await createTerminal(scope)

    expect(
      tabIdsAfterCreate(scope, [
        { id: 'existing-tab::left', parentTabId: 'existing-tab' },
        { id: 'existing-tab::right', parentTabId: 'existing-tab' },
        { id: 'trailing-tab' }
      ])
    ).toEqual(['existing-tab::left', 'existing-tab::right', 'terminal-tab-1', 'trailing-tab'])
  })

  it('waits for an older host snapshot instead of guessing its placement', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.activeSessionTabId = 'existing-tab::left'
    await createTerminal(scope)

    expect(scope.setSessionTabs).not.toHaveBeenCalled()
    expect(scope.pendingActiveSessionTabIdRef.current).toBe('terminal-tab-1')
    expect(scope.pendingActiveTerminalHandleRef.current).toBe('terminal-1')
    expect(scope.subscribeToTerminal).toHaveBeenCalledWith('terminal-1')
  })

  it('sends the same anchor it paints with', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.hostCapabilities = [SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY]
    await createTerminal(scope)

    expect(scope.client.sendRequest).toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.objectContaining({ afterTabId: 'existing-tab' })
    )
  })

  it('appends when the anchor is not in the client list, matching the host fallback', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.hostCapabilities = [SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY]
    await createTerminal(scope)

    expect(tabIdsAfterCreate(scope, [{ id: 'unrelated-tab' }])).toEqual([
      'unrelated-tab',
      'terminal-tab-1'
    ])
  })

  it('leaves the list alone when the host snapshot already placed the tab', async () => {
    const scope = createScope(clientReturning(terminalCreateResponse()))
    scope.hostCapabilities = [SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY]
    await createTerminal(scope)

    const prior = [{ id: 'existing-tab' }, { id: 'terminal-tab-1' }, { id: 'trailing-tab' }]
    expect(tabIdsAfterCreate(scope, prior)).toEqual([
      'existing-tab',
      'terminal-tab-1',
      'trailing-tab'
    ])
  })
})
