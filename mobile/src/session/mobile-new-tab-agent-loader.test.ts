import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { FLOATING_WORKSPACE_WORKTREE_ID } from './floating-workspace'
import { loadMobileNewTabAgentOptions } from './mobile-new-tab-agent-loader'

function createClient(
  handler: (method: string, params?: unknown) => Promise<unknown>
): RpcClient & { sendRequest: ReturnType<typeof vi.fn> } {
  return {
    sendRequest: vi.fn(handler),
    subscribe: vi.fn(() => () => {})
  } as unknown as RpcClient & { sendRequest: ReturnType<typeof vi.fn> }
}

describe('mobile new-tab agent loading', () => {
  it('detects agents locally for the floating workspace without listing repos', async () => {
    const client = createClient(async (method) => {
      if (method === 'settings.get') {
        return {
          ok: true,
          result: { settings: { defaultTuiAgent: 'codex', disabledTuiAgents: [] } }
        }
      }
      if (method === 'preflight.detectAgents') {
        return { ok: true, result: ['claude', 'codex'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({
        client,
        worktreeId: FLOATING_WORKSPACE_WORKTREE_ID
      })
    ).resolves.toEqual([
      { agent: 'codex', label: 'Codex' },
      { agent: 'claude', label: 'Claude' }
    ])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'preflight.detectAgents',
      'settings.get'
    ])
  })

  it('detects agents on the paired host for a folder workspace instead of failing repo lookup', async () => {
    const client = createClient(async (method) => {
      if (method === 'settings.get') {
        return {
          ok: true,
          result: { settings: { defaultTuiAgent: 'claude', disabledTuiAgents: [] } }
        }
      }
      if (method === 'preflight.detectAgents') {
        return { ok: true, result: ['claude'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({
        client,
        worktreeId: 'folder-workspace:group-1::/Users/ada/notes'
      })
    ).resolves.toEqual([{ agent: 'claude', label: 'Claude' }])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).not.toContain('repo.list')
  })

  it('detects agents through the worktree repo connection for SSH sessions', async () => {
    const client = createClient(async (method, params) => {
      if (method === 'settings.get') {
        return { ok: true, result: { settings: {} } }
      }
      if (method === 'repo.list') {
        return { ok: true, result: { repos: [{ id: 'repo-1', connectionId: 'ssh-1' }] } }
      }
      if (method === 'preflight.detectRemoteAgents') {
        expect(params).toEqual({ connectionId: 'ssh-1' })
        return { ok: true, result: ['claude'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({
        client,
        worktreeId: 'repo-1::/remote/worktree'
      })
    ).resolves.toEqual([{ agent: 'claude', label: 'Claude' }])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'repo.list',
      'settings.get',
      'preflight.detectRemoteAgents'
    ])
  })

  // Orca #27054: the host resolves a local workspace's own runtime (a WSL distro on a Windows host)
  // from the workspace it is asked about. An older host discards the params, as before.
  it('names the workspace when it asks the paired host to detect agents for a local repo', async () => {
    const client = createClient(async (method, params) => {
      if (method === 'settings.get') {
        return { ok: true, result: { settings: {} } }
      }
      if (method === 'repo.list') {
        return { ok: true, result: { repos: [{ id: 'repo-1' }] } }
      }
      if (method === 'preflight.detectAgents') {
        expect(params).toEqual({ worktreeId: 'repo-1::/Users/ada/app' })
        return { ok: true, result: ['codex'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({ client, worktreeId: 'repo-1::/Users/ada/app' })
    ).resolves.toEqual([{ agent: 'codex', label: 'Codex' }])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toContain('preflight.detectAgents')
  })
})
