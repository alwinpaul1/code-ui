import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'
import { resolveAgentHudLaunchConfig } from './agent-hud-launch-config'

function fakeHost(agentDefaultArgs: Record<string, string>, hostPlatform: string) {
  const sendRequest = vi.fn(async (method: string) =>
    method === 'settings.get'
      ? { ok: true, result: { agentDefaultArgs, agentDefaultEnv: {} } }
      : { ok: true, result: { hostPlatform } }
  )
  return { sendRequest } as unknown as RpcClient
}

// The second review of 59c9643a, 2026-09-25. A Windows host still holds the
// flag an earlier build saved in its launch profile until the connect sync
// takes it out. A tab the phone opened before that write landed launched with
// the host's own profile, flag and all, and Claude refused to start ("Error:
// Invalid JSON provided to --settings").
describe('a tab the phone opens on a Windows host', () => {
  it('starts without a beacon flag an earlier build saved there, keeping the rest', async () => {
    const client = fakeHost(
      {
        claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}`,
        codex: agentHudLaunchFlag('codex', 'win32')
      },
      'win32'
    )
    expect(await resolveAgentHudLaunchConfig(client, 'claude')).toEqual({ agentArgs: '--verbose', agentEnv: {} })
    expect(await resolveAgentHudLaunchConfig(client, 'codex')).toEqual({ agentArgs: '', agentEnv: {} })
  })

  it('launches exactly as the desktop would when nothing of ours is saved there', async () => {
    const client = fakeHost({ claude: '--verbose', codex: '' }, 'win32')
    expect(await resolveAgentHudLaunchConfig(client, 'claude')).toBeNull()
    expect(await resolveAgentHudLaunchConfig(client, 'codex')).toBeNull()
  })

  it('still gets the flag on macOS, after what the host saved', async () => {
    const client = fakeHost({ claude: '--verbose' }, 'darwin')
    expect(await resolveAgentHudLaunchConfig(client, 'claude')).toEqual({
      agentArgs: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      agentEnv: {}
    })
  })
})
