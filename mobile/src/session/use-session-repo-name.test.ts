import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { repoDisplayNameFromList, useSessionRepoName } from './use-session-repo-name'

// The header subtitle's repo half (parity gap G9) comes from `repo.list`. A read that failed while
// the relay dialled must come back by itself on the next connection, once, not in a loop.

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const listReply = (repos: unknown[]) => ({ id: 'repos', ok: true, result: { repos }, _meta: { runtimeId: 'r' } })
const refused = { id: 'repos', ok: false, error: { code: 'timeout', message: 'relay dialling' }, _meta: { runtimeId: 'r' } }

function harness(sendRequest: ReturnType<typeof vi.fn>, worktreeId = 'repo-1::/work/a') {
  const client = { sendRequest } as unknown as RpcClient
  const seen: (string | null)[] = []
  function Harness(props: { lastConnectedAt: number }): null {
    seen.push(useSessionRepoName({ client, connState: 'connected', worktreeId, lastConnectedAt: props.lastConnectedAt }))
    return null
  }
  const render = async (lastConnectedAt: number) => {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { lastConnectedAt }))
      } else {
        renderer = create(createElement(Harness, { lastConnectedAt }))
      }
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  return { seen, render }
}

describe('the header reads the repo name once per connection', () => {
  it("reads the workspace's repo display name", async () => {
    const sendRequest = vi.fn().mockResolvedValue(listReply([{ id: 'repo-2', displayName: 'other' }, { id: 'repo-1', displayName: 'orca' }]))
    const { seen, render } = harness(sendRequest)
    await render(1)
    expect(seen.at(-1)).toBe('orca')
    expect(sendRequest.mock.calls[0]?.[0]).toBe('repo.list')
  })

  it('shows nothing after a refused read, and reads again when the host connects again', async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce(refused).mockResolvedValue(listReply([{ id: 'repo-1', displayName: 'orca' }]))
    const { seen, render } = harness(sendRequest)
    await render(1)
    expect(seen.at(-1)).toBeNull()
    // A re-render on the same connection does not retry.
    await render(1)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await render(2)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(seen.at(-1)).toBe('orca')
  })

  it('shows nothing when the read throws', async () => {
    const { seen, render } = harness(vi.fn().mockRejectedValue(new Error('socket closed')))
    await render(1)
    expect(seen.at(-1)).toBeNull()
  })

  it('never reads for the floating workspace, which has no repo', async () => {
    const sendRequest = vi.fn()
    const { seen, render } = harness(sendRequest, 'global-floating-terminal')
    await render(1)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(seen.at(-1)).toBeNull()
  })
})

describe('repoDisplayNameFromList', () => {
  it('is null for an empty list, a missing repo, a blank name or a non-list', () => {
    expect(repoDisplayNameFromList([], 'repo-1')).toBeNull()
    expect(repoDisplayNameFromList([{ id: 'repo-2', displayName: 'x' }], 'repo-1')).toBeNull()
    expect(repoDisplayNameFromList([{ id: 'repo-1', displayName: '  ' }], 'repo-1')).toBeNull()
    expect(repoDisplayNameFromList('nope', 'repo-1')).toBeNull()
    expect(repoDisplayNameFromList([{ id: 'repo-1', displayName: 'orca' }], '')).toBeNull()
  })

  it('reads a one-repo host', () => {
    expect(repoDisplayNameFromList([{ id: 'repo-1', displayName: ' orca ' }], 'repo-1')).toBe('orca')
  })
})
