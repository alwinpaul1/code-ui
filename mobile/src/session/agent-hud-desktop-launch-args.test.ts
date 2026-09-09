import { describe, expect, it, vi } from 'vitest'
import { tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'
import type { RpcClient } from '../transport/rpc-client'
import {
  agentHudDesktopFlag,
  hasAgentHudDesktopFlag,
  syncAgentHudDesktopLaunchArgs,
  withAgentHudDesktopFlag,
  withoutAgentHudDesktopFlag
} from './agent-hud-desktop-launch-args'

// Asked for on 2026-09-09: the desktop is the main place agents are started,
// the phone is for when the user is away, so desktop-started agents must paint
// the HUD too. Orca appends `agentDefaultArgs` to every agent it launches.
describe('desktop launch profile carries the status-line flags', () => {
  it('appends our flag after the user\'s own args and never stacks a second copy', () => {
    const once = withAgentHudDesktopFlag('claude', '--dangerously-skip-permissions')
    expect(once).toBe(`--dangerously-skip-permissions ${agentHudDesktopFlag('claude')}`)
    expect(withAgentHudDesktopFlag('claude', once)).toBe(once)
    const tokens = tokenizeStartupCommand(once, 'posix')
    expect(tokens.ok && tokens.tokens.length).toBe(3)
  })

  it('replaces an older version of our flag instead of keeping both', () => {
    const old = `--settings '{"statusLine":{"type":"command","command":"echo old"}}'`
    const next = withAgentHudDesktopFlag('claude', `--verbose ${old}`)
    expect(next.startsWith('--verbose --settings ')).toBe(true)
    expect(next).not.toContain('echo old')
    expect((next.match(/--settings/g) ?? []).length).toBe(1)
  })

  it('removes exactly our flag and leaves the user\'s args as they were', () => {
    const withOurs = withAgentHudDesktopFlag('codex', '--search')
    expect(hasAgentHudDesktopFlag('codex', withOurs)).toBe(true)
    expect(withoutAgentHudDesktopFlag('codex', withOurs)).toBe('--search')
    expect(withoutAgentHudDesktopFlag('codex', '--search')).toBe('--search')
  })

  it('writes the profile once when switched on, and nothing on a reconnect', async () => {
    let stored: Record<string, string> = { claude: '--verbose' }
    const sendRequest = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'settings.get') {
        return { ok: true, result: { agentDefaultArgs: { ...stored } } }
      }
      stored = { ...(params as { agentDefaultArgs: Record<string, string> }).agentDefaultArgs }
      return { ok: true, result: {} }
    })
    const client = { sendRequest } as unknown as RpcClient

    const written = await syncAgentHudDesktopLaunchArgs(client, true)
    expect(written?.claude).toBe(`--verbose ${agentHudDesktopFlag('claude')}`)
    expect(written?.codex).toBe(agentHudDesktopFlag('codex'))
    expect(sendRequest.mock.calls.map(([m]) => m)).toEqual(['settings.get', 'settings.update'])

    sendRequest.mockClear()
    expect(await syncAgentHudDesktopLaunchArgs(client, true)).toBeNull()
    expect(sendRequest.mock.calls.map(([m]) => m)).toEqual(['settings.get'])

    sendRequest.mockClear()
    const removed = await syncAgentHudDesktopLaunchArgs(client, false)
    expect(removed?.claude).toBe('--verbose')
    expect(removed?.codex).toBeUndefined()
  })
})
