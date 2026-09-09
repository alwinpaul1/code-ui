import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'
import {
  syncAgentHudDesktopLaunchArgs,
  withAgentHudDesktopFlag,
  withoutAgentHudDesktopFlag
} from './agent-hud-desktop-launch-args'

// 0.2.77 wrote these into Orca's launch profile for a few hours on 2026-09-09.
// They put a visible row in the user's terminals; every later build removes them.
const oldClaudeFlag = `--settings '{"statusLine":{"type":"command","command":"i=$(cat); printf x"}}'`
const oldCodexFlag = `-c 'tui.status_line=["model-with-reasoning","context-remaining"]'`

/** A host that answers `settings.get` and `status.get` and records the write. */
function fakeHost(stored: Record<string, string>, hostPlatform: string | null = 'darwin') {
  let current = { ...stored }
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'settings.get') {
      return { ok: true, result: { agentDefaultArgs: { ...current } } }
    }
    if (method === 'status.get') {
      return { ok: true, result: hostPlatform ? { hostPlatform } : {} }
    }
    current = { ...(params as { agentDefaultArgs: Record<string, string> }).agentDefaultArgs }
    return { ok: true, result: {} }
  })
  return {
    client: { sendRequest } as unknown as RpcClient,
    sendRequest,
    stored: () => current
  }
}

describe('the desktop launch profile carries the beacon flags and nothing else', () => {
  it("adds one flag per agent and keeps the user's own arguments in front", () => {
    expect(withAgentHudDesktopFlag('claude', '--verbose', 'darwin')).toBe(
      `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`
    )
    expect(withAgentHudDesktopFlag('codex', undefined, 'darwin')).toBe(
      agentHudLaunchFlag('codex', 'darwin')
    )
  })

  it('replaces an older flag of ours instead of stacking a second one', () => {
    const twice = withAgentHudDesktopFlag(
      'claude',
      withAgentHudDesktopFlag('claude', '--verbose', 'darwin'),
      'darwin'
    )
    expect(twice).toBe(`--verbose ${agentHudLaunchFlag('claude', 'darwin')}`)
    expect(twice.match(/--settings/g)).toHaveLength(1)
  })

  it("sweeps out 0.2.77's visible status lines wherever they are still found", () => {
    expect(withoutAgentHudDesktopFlag('claude', `--verbose ${oldClaudeFlag}`)).toBe('--verbose')
    expect(withoutAgentHudDesktopFlag('codex', `--search ${oldCodexFlag}`)).toBe('--search')
    // Turning the switch ON must not leave the old visible one behind either.
    expect(withAgentHudDesktopFlag('codex', `--search ${oldCodexFlag}`, 'darwin')).toBe(
      `--search ${agentHudLaunchFlag('codex', 'darwin')}`
    )
    expect(withoutAgentHudDesktopFlag('claude', '--dangerously-skip-permissions')).toBe(
      '--dangerously-skip-permissions'
    )
  })

  it('recognises and replaces the PowerShell flag a Windows host carries', () => {
    const windows = withAgentHudDesktopFlag('codex', '--search', 'win32')
    expect(windows).toContain('powershell')
    // Written by a phone that then saw the host report darwin: one flag, not two.
    expect(withAgentHudDesktopFlag('codex', windows, 'darwin')).toBe(
      `--search ${agentHudLaunchFlag('codex', 'darwin')}`
    )
    expect(withoutAgentHudDesktopFlag('codex', windows)).toBe('--search')
  })

  it('writes once, then leaves an already-correct host alone', async () => {
    const host = fakeHost({ claude: '--verbose' })

    const written = await syncAgentHudDesktopLaunchArgs(host.client, true)
    expect(written).toEqual({
      claude: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: agentHudLaunchFlag('codex', 'darwin')
    })
    expect(host.sendRequest.mock.calls.map(([m]) => m)).toContain('settings.update')

    host.sendRequest.mockClear()
    expect(await syncAgentHudDesktopLaunchArgs(host.client, true)).toBeNull()
    expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
  })

  it('writes the PowerShell notify command to a Windows host', async () => {
    const host = fakeHost({}, 'win32')
    const written = await syncAgentHudDesktopLaunchArgs(host.client, true)
    expect(written?.codex).toContain('powershell')
    expect(written?.codex).not.toContain('"sh"')
    // Claude's flag is the same everywhere; only the sh script inside branches.
    expect(written?.claude).toBe(agentHudLaunchFlag('claude', 'darwin'))
  })

  it('gives the profile back exactly as it was when the switch is turned off', async () => {
    const host = fakeHost({
      claude: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: agentHudLaunchFlag('codex', 'darwin')
    })
    expect(await syncAgentHudDesktopLaunchArgs(host.client, false)).toEqual({ claude: '--verbose' })
    // codex had nothing but our flag, so its key goes rather than sitting empty.
    expect(host.stored()).toEqual({ claude: '--verbose' })
  })
})
