import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'

// One fake host context: the hook reads `lastConnectedAt` and the client
// through it, and the test moves the connection by calling its listeners.
const host = vi.hoisted(() => ({
  client: null as RpcClient | null,
  lastConnectedAt: null as number | null,
  listeners: new Set<(state: ConnectionState) => void>()
}))
vi.mock('./client-context', () => ({
  useHostClient: () => ({ client: host.client, clientId: 'c1', state: 'connected' }),
  useRpcClientContext: () => ({
    getLastConnectedAt: () => host.lastConnectedAt,
    subscribeHostState: (_hostId: string, listener: (state: ConnectionState) => void) => {
      host.listeners.add(listener)
      return () => host.listeners.delete(listener)
    }
  })
}))

import {
  AGENT_SESSION_REWIND_GATE_PROBE_PARAMS,
  FILES_WRITE_GATE_PROBE_PARAMS
} from './host-mobile-capability-operations'
import { isMobileScopeRefusal } from './mobile-scope-refusal'
import {
  ensureHostMobileCapabilitiesProbed,
  peekHostMobileCapabilities,
  probeHostMobileCapabilities,
  readHostMobileCapabilityVerdict,
  resetHostMobileCapabilitiesForTests,
  useHostMobileCapability,
  type HostMobileCapabilityKey
} from './host-mobile-capabilities'

// The literal strings below are the host's real wire text, read from the Orca
// 1.4.205 bundle (`/tmp/orca-asar/out/main/index.js`, 2026-09-18), not
// paraphrases. See host-mobile-capability-operations.ts for where each comes from.
function refused(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'r' } }
}

function accepted(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'r' } }
}

const GATE_REFUSES_FILES_WRITE = refused(
  'forbidden',
  "Method 'files.write' is not available to mobile clients"
)
const GATE_REFUSES_REWIND = refused(
  'forbidden',
  "Method 'agentSession.rewind' is not available to mobile clients"
)
/** `resolveWorktreeSelector` for an id no worktree has: what 1.4.205 answers first. */
const NO_SUCH_WORKTREE = refused('runtime_error', 'selector_not_found')
/** The jail check `Kg()`, had the worktree resolved. */
const JAILED_PATH = refused('runtime_error', 'invalid_relative_path')
/** `VN` admission for a session id with no journal, inside an accepted envelope. */
const NO_SUCH_SESSION = accepted({
  ok: false,
  refusal: {
    code: 'agent_session_ownership_unknown',
    message: 'This host holds no attached session by that id.'
  }
})
/** Also `forbidden`, not this gate: a client-hosted browser page without a paired runtime. */
const OTHER_FORBIDDEN = refused(
  'forbidden',
  'Client-hosted browser pages require an authenticated paired runtime.'
)

describe('reading the mobile-scope gate off a reply', () => {
  it('reads the gate’s own refusal, for either method, as forbidden', () => {
    expect(isMobileScopeRefusal(GATE_REFUSES_FILES_WRITE)).toBe(true)
    expect(isMobileScopeRefusal(GATE_REFUSES_REWIND)).toBe(true)
    expect(readHostMobileCapabilityVerdict(GATE_REFUSES_FILES_WRITE)).toBe('forbidden')
  })

  it('reads the host refusing the PROBE’s parameters as the gate having let it through', () => {
    expect(readHostMobileCapabilityVerdict(NO_SUCH_WORKTREE)).toBe('allowed')
    expect(readHostMobileCapabilityVerdict(JAILED_PATH)).toBe('allowed')
    expect(readHostMobileCapabilityVerdict(NO_SUCH_SESSION)).toBe('allowed')
  })

  it('does not mistake another forbidden for the gate: the code alone is not the gate', () => {
    expect(isMobileScopeRefusal(OTHER_FORBIDDEN)).toBe(false)
    expect(readHostMobileCapabilityVerdict(OTHER_FORBIDDEN)).toBe('allowed')
  })

  it('reads a bare success as allowed, so a host that skipped its own check still shows the button', () => {
    expect(readHostMobileCapabilityVerdict(accepted({ ok: true }))).toBe('allowed')
  })
})

type Script = Record<string, () => Promise<RpcResponse>>

function scriptedClient(script: Script): { client: RpcClient; sendRequest: ReturnType<typeof vi.fn> } {
  const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> => {
    const reply = script[method]
    if (!reply) {
      throw new Error(`unscripted ${method}`)
    }
    return reply()
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

describe('probing a host', () => {
  it('sends parameters the host must refuse without writing or rewinding anything', async () => {
    const { client, sendRequest } = scriptedClient({
      'files.write': async () => NO_SUCH_WORKTREE,
      'agentSession.rewind': async () => NO_SUCH_SESSION
    })
    await probeHostMobileCapabilities(client)
    const filesWrite = sendRequest.mock.calls.find((call) => call[0] === 'files.write')
    const rewind = sendRequest.mock.calls.find((call) => call[0] === 'agentSession.rewind')
    expect(filesWrite?.[1]).toBe(FILES_WRITE_GATE_PROBE_PARAMS)
    // A `..` segment, which the jail check refuses, and a worktree no host allocates.
    expect(FILES_WRITE_GATE_PROBE_PARAMS.relativePath.split('/')).toContain('..')
    expect(FILES_WRITE_GATE_PROBE_PARAMS.worktree).toMatch(/^id:/)
    expect(rewind?.[1]).toBe(AGENT_SESSION_REWIND_GATE_PROBE_PARAMS)
    // Valid in shape (upstream's SESSION_ID_PATTERN), so the params parse is
    // not what refuses it, and named so a host log line explains itself.
    expect(AGENT_SESSION_REWIND_GATE_PROBE_PARAMS.envelope.sessionId).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
    expect(AGENT_SESSION_REWIND_GATE_PROBE_PARAMS.envelope.sessionId).toContain('probe')
    expect(AGENT_SESSION_REWIND_GATE_PROBE_PARAMS.envelope.payloadFingerprint).toMatch(/^[0-9a-f]{64}$/)
    // Does not queue behind a reconnect: the answer belongs to one connection.
    expect(filesWrite?.[2]).toEqual({ failWhenDisconnected: true })
  })

  it('answers each method on its own: a gate on one and a pass on the other', async () => {
    const { client } = scriptedClient({
      'files.write': async () => GATE_REFUSES_FILES_WRITE,
      'agentSession.rewind': async () => NO_SUCH_SESSION
    })
    await expect(probeHostMobileCapabilities(client)).resolves.toEqual({
      'files.write': 'forbidden',
      'agentSession.rewind': 'allowed'
    })
  })

  it('reads the 1.4.205 host as it really answers: both gated', async () => {
    const { client } = scriptedClient({
      'files.write': async () => GATE_REFUSES_FILES_WRITE,
      'agentSession.rewind': async () => GATE_REFUSES_REWIND
    })
    await expect(probeHostMobileCapabilities(client)).resolves.toEqual({
      'files.write': 'forbidden',
      'agentSession.rewind': 'forbidden'
    })
  })

  it('turns a transport failure into unknown for THAT method only, and never throws', async () => {
    const { client } = scriptedClient({
      'files.write': async () => {
        throw new Error('Request timed out: files.write')
      },
      'agentSession.rewind': async () => NO_SUCH_SESSION
    })
    await expect(probeHostMobileCapabilities(client)).resolves.toEqual({
      'files.write': 'unknown',
      'agentSession.rewind': 'allowed'
    })
  })
})

describe('once per connection', () => {
  beforeEach(() => resetHostMobileCapabilitiesForTests())

  it('probes a host once for one connection, however many times it is asked', async () => {
    const probe = vi.fn(async () => ({
      'files.write': 'allowed' as const,
      'agentSession.rewind': 'allowed' as const
    }))
    const client = {} as RpcClient
    ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    await Promise.resolve()
    ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(peekHostMobileCapabilities('h1')['files.write']).toBe('allowed')
  })

  it('probes again on a new connection, and a refused probe does not spin', async () => {
    const probe = vi.fn(async () => ({
      'files.write': 'unknown' as const,
      'agentSession.rewind': 'unknown' as const
    }))
    const client = {} as RpcClient
    ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    await Promise.resolve()
    // The host stayed down; the same connection asks nothing more.
    for (let index = 0; index < 20; index += 1) {
      ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    }
    expect(probe).toHaveBeenCalledTimes(1)
    ensureHostMobileCapabilitiesProbed('h1', client, 2_000, probe)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('drops a probe that settles after its connection was replaced', async () => {
    let settleFirst!: (verdicts: Awaited<ReturnType<typeof probeHostMobileCapabilities>>) => void
    const first = new Promise<Awaited<ReturnType<typeof probeHostMobileCapabilities>>>((resolve) => {
      settleFirst = resolve
    })
    const probe = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({
        'files.write': 'forbidden' as const,
        'agentSession.rewind': 'forbidden' as const
      }))
    const client = {} as RpcClient
    ensureHostMobileCapabilitiesProbed('h1', client, 1_000, probe)
    ensureHostMobileCapabilitiesProbed('h1', client, 2_000, probe)
    await Promise.resolve()
    expect(peekHostMobileCapabilities('h1')['files.write']).toBe('forbidden')
    // The stale answer lands late and must not overwrite the current one.
    settleFirst({ 'files.write': 'allowed', 'agentSession.rewind': 'allowed' })
    await Promise.resolve()
    expect(peekHostMobileCapabilities('h1')['files.write']).toBe('forbidden')
  })

  it('answers unknown for a host it has never probed', () => {
    expect(peekHostMobileCapabilities('never')).toEqual({
      'files.write': 'unknown',
      'agentSession.rewind': 'unknown'
    })
  })
})

describe('useHostMobileCapability', () => {
  let renderer: ReactTestRenderer | null = null
  const seen: boolean[] = []

  function Probe({ hostId, capability }: { hostId: string; capability: HostMobileCapabilityKey }): null {
    seen.push(useHostMobileCapability(hostId, capability))
    return null
  }

  beforeEach(() => {
    resetHostMobileCapabilitiesForTests()
    host.client = null
    host.lastConnectedAt = null
    host.listeners.clear()
    seen.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(capability: HostMobileCapabilityKey): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Probe, { hostId: 'h1', capability }))
    })
  }

  async function connect(at: number): Promise<void> {
    await act(async () => {
      host.lastConnectedAt = at
      for (const listener of host.listeners) {
        listener('connected')
      }
    })
  }

  it('is false until the host has been asked, then true once the gate let the call through', async () => {
    const { client, sendRequest } = scriptedClient({
      'files.write': async () => JAILED_PATH,
      'agentSession.rewind': async () => NO_SUCH_SESSION
    })
    host.client = client
    host.lastConnectedAt = 1_000
    await render('files.write')
    expect(seen[0]).toBe(false)
    expect(seen.at(-1)).toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('stays false on a host that refuses, and a second render does not ask again', async () => {
    const { client, sendRequest } = scriptedClient({
      'files.write': async () => GATE_REFUSES_FILES_WRITE,
      'agentSession.rewind': async () => GATE_REFUSES_REWIND
    })
    host.client = client
    host.lastConnectedAt = 1_000
    await render('agentSession.rewind')
    expect(seen.at(-1)).toBe(false)
    await act(async () => {
      renderer!.update(createElement(Probe, { hostId: 'h1', capability: 'agentSession.rewind' }))
    })
    expect(seen.at(-1)).toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('asks once per connection: a reconnect re-probes, a render does not', async () => {
    let answer: RpcResponse = GATE_REFUSES_FILES_WRITE
    const { client, sendRequest } = scriptedClient({
      'files.write': async () => answer,
      'agentSession.rewind': async () => GATE_REFUSES_REWIND
    })
    host.client = client
    host.lastConnectedAt = 1_000
    await render('files.write')
    expect(seen.at(-1)).toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    // The desktop was upgraded past the gate and the phone reconnected.
    answer = JAILED_PATH
    await connect(2_000)
    expect(sendRequest).toHaveBeenCalledTimes(4)
    expect(seen.at(-1)).toBe(true)
  })

  it('does not ask while the host has never connected', async () => {
    const { client, sendRequest } = scriptedClient({})
    host.client = client
    host.lastConnectedAt = null
    await render('files.write')
    expect(sendRequest).not.toHaveBeenCalled()
    expect(seen.at(-1)).toBe(false)
  })

  it('failure path: a probe the transport loses reads false, throws nothing, and does not loop', async () => {
    const { client, sendRequest } = scriptedClient({
      'files.write': async () => {
        throw new Error('Connection interrupted')
      },
      'agentSession.rewind': async () => {
        throw new Error('Connection interrupted')
      }
    })
    host.client = client
    host.lastConnectedAt = 1_000
    await render('files.write')
    await act(async () => {
      renderer!.update(createElement(Probe, { hostId: 'h1', capability: 'files.write' }))
    })
    expect(seen.every((value) => value === false)).toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    // The next connection is the retry, not the next render.
    await connect(2_000)
    expect(sendRequest).toHaveBeenCalledTimes(4)
  })
})
