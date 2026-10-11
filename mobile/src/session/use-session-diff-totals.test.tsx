import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

// The diff pill's +/- is read when the chat opens, when the agent finishes a
// turn, and on every new connection — so a read that failed while the relay
// was dialling comes right by itself (root CLAUDE.md, "Nothing stays stale").

const connection = vi.hoisted(() => ({ lastConnectedAt: 1 as number | null }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => connection.lastConnectedAt
}))
vi.mock('react-native', () => ({}))

import { useSessionDiffTotals, type SessionDiffRead } from './use-session-diff-totals'
import type { SessionDiffTotals } from './mobile-native-chat-session-bar-model'

const CLIENT = {} as RpcClient
let shown: SessionDiffTotals | null | undefined
let renderer: ReactTestRenderer | null = null

function Harness(props: { read: SessionDiffRead; connState: ConnectionState; agentWorking: boolean; client?: RpcClient | null }) {
  shown = useSessionDiffTotals({
    client: props.client === undefined ? CLIENT : props.client,
    connState: props.connState,
    hostId: 'host',
    worktreeId: 'wt',
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

beforeEach(() => {
  connection.lastConnectedAt = 1
  shown = undefined
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the diff pill’s totals', () => {
  it('reads once when the chat opens on a live connection, never while it is down', async () => {
    const read = vi.fn<SessionDiffRead>().mockResolvedValue({ files: 1, added: 5, removed: 2 })
    await render({ read, connState: 'connecting', agentWorking: false })
    expect(read).not.toHaveBeenCalled()
    expect(shown).toBeNull()
    await render({ read, connState: 'connected', agentWorking: false })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(1)
    expect(shown).toEqual({ files: 1, added: 5, removed: 2 })
  })

  it('reads again when the agent finishes a turn, not when it starts one', async () => {
    const read = vi
      .fn<SessionDiffRead>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ files: 2, added: 30, removed: 4 })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(shown).toBeNull()
    await render({ read, connState: 'connected', agentWorking: true })
    expect(read).toHaveBeenCalledTimes(1)
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown).toEqual({ files: 2, added: 30, removed: 4 })
  })

  it('retries a read that failed while dialling once a new connection comes up', async () => {
    const read = vi
      .fn<SessionDiffRead>()
      .mockRejectedValueOnce(new Error('relay timeout'))
      .mockResolvedValueOnce({ files: 1, added: 1, removed: 0 })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(shown).toBeNull()
    connection.lastConnectedAt = 2
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown).toEqual({ files: 1, added: 1, removed: 0 })
  })

  it('keeps the last answer when a later read fails', async () => {
    const read = vi
      .fn<SessionDiffRead>()
      .mockResolvedValueOnce({ files: 1, added: 3, removed: 3 })
      .mockRejectedValueOnce(new Error('git.status refused'))
    await render({ read, connState: 'connected', agentWorking: true })
    await render({ read, connState: 'connected', agentWorking: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(shown).toEqual({ files: 1, added: 3, removed: 3 })
  })

  it('reads nothing without a client', async () => {
    const read = vi.fn<SessionDiffRead>().mockResolvedValue({ files: 1, added: 1, removed: 1 })
    await render({ read, connState: 'connected', agentWorking: false, client: null })
    expect(read).not.toHaveBeenCalled()
    expect(shown).toBeNull()
  })
})
