import { describe, expect, it, vi } from 'vitest'
import { refreshAccountUsage } from './refresh-account-usage'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

function fakeClient(state: ConnectionState) {
  const sendRequest = vi.fn(async (method: string) => ({
    ok: true as const,
    result: { v: 1, accounts: [] },
    _meta: { runtimeId: 'r' },
    method
  }))
  const notifyForeground = vi.fn()
  const client = {
    sendRequest,
    getState: () => state,
    notifyForeground,
    subscribe: vi.fn(),
    onStateChange: vi.fn(() => () => {}),
    close: vi.fn()
  } as unknown as RpcClient
  return { client, sendRequest, notifyForeground }
}

describe('pull-to-refresh on Home reads account usage only', () => {
  it('sends one accounts.list per connected host and nothing that touches the connection', async () => {
    const a = fakeClient('connected')
    const b = fakeClient('connected')
    const setSnapshots = vi.fn()

    await refreshAccountUsage(
      [
        { hostId: 'a', client: a.client },
        { hostId: 'b', client: b.client }
      ],
      setSnapshots
    )

    expect(a.sendRequest.mock.calls.map(([method]) => method)).toEqual(['accounts.list'])
    expect(b.sendRequest.mock.calls.map(([method]) => method)).toEqual(['accounts.list'])
    expect(a.notifyForeground).not.toHaveBeenCalled()
    expect(b.notifyForeground).not.toHaveBeenCalled()
    expect(setSnapshots).toHaveBeenCalledTimes(2)
  })

  it('skips hosts that are not connected instead of waking them', async () => {
    const idle = fakeClient('reconnecting')
    await refreshAccountUsage([{ hostId: 'idle', client: idle.client }], vi.fn())
    expect(idle.sendRequest).not.toHaveBeenCalled()
    expect(idle.notifyForeground).not.toHaveBeenCalled()
  })

  it('still resolves when a host refuses the request', async () => {
    const bad = fakeClient('connected')
    bad.sendRequest.mockRejectedValueOnce(new Error('nope'))
    await expect(
      refreshAccountUsage([{ hostId: 'bad', client: bad.client }], vi.fn())
    ).resolves.toBeUndefined()
  })
})
