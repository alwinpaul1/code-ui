import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

// The session pills ask Orca which branch the worktree is on, whether it has a remote branch, and
// which commit it is at. Read when the chat opens, again each time the agent finishes a turn (the
// moment a push or a commit has landed), and on every new connection to the host, so a read that
// failed while the relay was dialling comes right by itself (root CLAUDE.md, "Nothing stays
// stale"). A read that cannot be had draws no pill, and says why in the log.

vi.mock('react-native', () => ({}))

import {
  readSessionBranchStatus,
  useSessionBranchStatus,
  type SessionBranchStatus,
  type SessionBranchStatusRead
} from './use-session-branch-status'

const CLIENT = {} as RpcClient

describe('reading the branch status', () => {
  const host = (reply: unknown) =>
    ({ sendRequest: vi.fn(async () => reply) }) as unknown as RpcClient & {
      sendRequest: ReturnType<typeof vi.fn>
    }

  it('keeps the branch, the commit and the remote branch the host stated', async () => {
    const client = host({
      id: 's',
      ok: true,
      result: {
        entries: [],
        conflictOperation: 'unknown',
        branch: 'feature/pills',
        head: 'abc123',
        upstreamStatus: { hasUpstream: true, ahead: 2, behind: 0 }
      },
      _meta: { runtimeId: 'r' }
    })
    await expect(readSessionBranchStatus(client, 'repo-1::/work/a')).resolves.toEqual({
      branch: 'feature/pills',
      head: 'abc123',
      hasUpstream: true,
      ahead: 2,
      behind: 0
    })
    expect(client.sendRequest.mock.calls[0]?.[0]).toBe('git.status')
    expect(client.sendRequest.mock.calls[0]?.[1]).toEqual({ worktree: 'id:repo-1::/work/a' })
  })

  it('leaves the remote branch unstated when the host did not state it', async () => {
    const client = host({
      id: 's',
      ok: true,
      result: { entries: [], conflictOperation: 'unknown', branch: 'main', head: 'abc123' },
      _meta: { runtimeId: 'r' }
    })
    await expect(readSessionBranchStatus(client, 'repo-1::/work/a')).resolves.toEqual({
      branch: 'main',
      head: 'abc123',
      hasUpstream: undefined,
      ahead: undefined,
      behind: undefined
    })
  })

  it('reads a detached HEAD as no branch, not as an empty name', async () => {
    const client = host({
      id: 's',
      ok: true,
      result: { entries: [], conflictOperation: 'unknown', head: 'abc123' },
      _meta: { runtimeId: 'r' }
    })
    await expect(readSessionBranchStatus(client, 'repo-1::/work/a')).resolves.toMatchObject({
      branch: null,
      head: 'abc123'
    })
  })

  it('answers nothing for a refusal, and for a reply that is not a status at all', async () => {
    await expect(
      readSessionBranchStatus(
        host({ id: 's', ok: false, error: { code: 'x', message: 'no repo' }, _meta: { runtimeId: 'r' } }),
        'repo-1::/work/a'
      )
    ).resolves.toBeNull()
    await expect(
      readSessionBranchStatus(
        host({ id: 's', ok: true, result: 'not a status', _meta: { runtimeId: 'r' } }),
        'repo-1::/work/a'
      )
    ).resolves.toBeNull()
  })
})

const connection = vi.hoisted(() => ({ lastConnectedAt: 1 as number | null }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => connection.lastConnectedAt
}))

let shown: { status: SessionBranchStatus | null; turnsEnded: number } | undefined
let renderer: ReactTestRenderer | null = null

function Harness(props: {
  read: SessionBranchStatusRead
  connState: ConnectionState
  agentWorking: boolean
  client?: RpcClient | null
  enabled?: boolean
  worktreeId?: string
}) {
  shown = useSessionBranchStatus({
    enabled: props.enabled,
    client: props.client === undefined ? CLIENT : props.client,
    connState: props.connState,
    hostId: 'host',
    worktreeId: props.worktreeId ?? 'wt',
    agentWorking: props.agentWorking,
    read: props.read
  })
  return null
}

async function render(props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    const element = createElement(Harness, props)
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

const FEATURE: SessionBranchStatus = {
  branch: 'feature/pills',
  head: 'abc123',
  hasUpstream: true,
  ahead: 0,
  behind: 0
}

beforeEach(() => {
  connection.lastConnectedAt = 1
  shown = undefined
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('the branch status behind the pills', () => {
  it('reads once when the chat opens on a live connection, never while it is down', async () => {
    const read = vi.fn<SessionBranchStatusRead>().mockResolvedValue(FEATURE)
    await render({ read, connState: 'connecting', agentWorking: false })
    expect(read).not.toHaveBeenCalled()
    expect(shown?.status).toBeNull()
    await render({ read, connState: 'connected', agentWorking: false })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(1)
    expect(shown?.status).toEqual(FEATURE)
  })

  it('reads again when the agent finishes a turn, not when it starts one, and counts the turn', async () => {
    const pushed = { ...FEATURE, ahead: 3 }
    const read = vi.fn<SessionBranchStatusRead>().mockResolvedValueOnce(FEATURE).mockResolvedValueOnce(pushed)
    await render({ read, connState: 'connected', agentWorking: false })
    expect(shown?.turnsEnded).toBe(0)
    await render({ read, connState: 'connected', agentWorking: true })
    expect(read).toHaveBeenCalledTimes(1)
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown?.turnsEnded).toBe(1)
    expect(shown?.status).toEqual(pushed)
  })

  it('retries a read that failed while dialling once a new connection comes up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = vi
      .fn<SessionBranchStatusRead>()
      .mockRejectedValueOnce(new Error('relay timeout'))
      .mockResolvedValueOnce(FEATURE)
    await render({ read, connState: 'connected', agentWorking: false })
    expect(shown?.status).toBeNull()
    // The failure leaves the one line that says where to look.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[session-pills] could not read the branch status'),
      expect.objectContaining({ worktreeId: 'wt', message: 'relay timeout' })
    )
    connection.lastConnectedAt = 2
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown?.status).toEqual(FEATURE)
  })

  it('keeps the last answer when a later read fails, so a blip does not blank the pills', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = vi
      .fn<SessionBranchStatusRead>()
      .mockResolvedValueOnce(FEATURE)
      .mockRejectedValueOnce(new Error('git.status refused'))
    await render({ read, connState: 'connected', agentWorking: true })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown?.status).toEqual(FEATURE)
  })

  it('keeps the last answer when a later read says nothing (a refusal), too', async () => {
    const read = vi
      .fn<SessionBranchStatusRead>()
      .mockResolvedValueOnce(FEATURE)
      .mockResolvedValueOnce(null)
    await render({ read, connState: 'connected', agentWorking: true })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown?.status).toEqual(FEATURE)
  })

  it('drops the answer of another worktree at once: its branch is not this one’s', async () => {
    // wt-a answers; wt-b's read never comes back, so only the drop can empty the pills.
    const read = vi
      .fn<SessionBranchStatusRead>()
      .mockImplementation((_client, worktreeId) =>
        worktreeId === 'wt-a' ? Promise.resolve(FEATURE) : new Promise(() => {})
      )
    await render({ read, connState: 'connected', agentWorking: false, worktreeId: 'wt-a' })
    expect(shown?.status?.branch).toBe('feature/pills')
    await render({ read, connState: 'connected', agentWorking: false, worktreeId: 'wt-b' })
    expect(shown?.status).toBeNull()
  })

  it('reads nothing while the chat is not on screen, and reads when it comes up', async () => {
    const read = vi.fn<SessionBranchStatusRead>().mockResolvedValue(FEATURE)
    await render({ read, connState: 'connected', agentWorking: false, enabled: false })
    await render({ read, connState: 'connected', agentWorking: true, enabled: false })
    await render({ read, connState: 'connected', agentWorking: false, enabled: false })
    expect(read).not.toHaveBeenCalled()
    await render({ read, connState: 'connected', agentWorking: false, enabled: true })
    expect(read).toHaveBeenCalledTimes(1)
    expect(shown?.status).toEqual(FEATURE)
  })

  it('reads nothing without a client', async () => {
    const read = vi.fn<SessionBranchStatusRead>().mockResolvedValue(FEATURE)
    await render({ read, connState: 'connected', agentWorking: false, client: null })
    expect(read).not.toHaveBeenCalled()
  })
})
