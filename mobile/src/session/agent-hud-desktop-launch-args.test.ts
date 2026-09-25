import { describe, expect, it, vi } from 'vitest'
import { getTuiAgentDefaultArgs, resolveTuiAgentLaunchArgs } from '../../../src/shared/tui-agent-launch-defaults'
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

/** A host that answers `settings.get` and `status.get` and records the write.
 *  `'rejects'` drives a `status.get` that fails outright. */
function fakeHost(stored: Record<string, string>, hostPlatform: string | null | 'rejects' = 'darwin') {
  let current = { ...stored }
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'settings.get') {
      return { ok: true, result: { agentDefaultArgs: { ...current } } }
    }
    if (method === 'status.get') {
      if (hostPlatform === 'rejects') {
        throw new Error('request timed out')
      }
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
      codex: `${getTuiAgentDefaultArgs('codex')} ${agentHudLaunchFlag('codex', 'darwin')}`
    })
    expect(host.sendRequest.mock.calls.map(([m]) => m)).toContain('settings.update')

    host.sendRequest.mockClear()
    expect(await syncAgentHudDesktopLaunchArgs(host.client, true)).toBeNull()
    expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
  })

  // 2026-09-25, a Windows user: every Claude launch failed with "Error:
  // Invalid JSON provided to --settings". Windows PowerShell 5.1 strips the
  // double quotes inside an argument it hands a native program, so the
  // settings JSON reached Claude Code without them. The Windows path had never
  // run on Windows. Until an encoding survives 5.1, a Windows host gets no flag.
  it('writes no beacon flag to a Windows host, even with the switch on', async () => {
    const host = fakeHost({}, 'win32')
    expect(await syncAgentHudDesktopLaunchArgs(host.client, true)).toBeNull()
    expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
    expect(host.stored()).toEqual({})
  })

  it('takes a flag already saved on a Windows host back out, keeping the user\'s own args', async () => {
    const host = fakeHost(
      {
        claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}`,
        codex: agentHudLaunchFlag('codex', 'win32')
      },
      'win32'
    )
    const written = await syncAgentHudDesktopLaunchArgs(host.client, true)
    expect(written?.claude).toBe('--verbose')
    expect(host.stored()).toEqual({ claude: '--verbose', codex: '' })
  })

  // The second review of 59c9643a, 2026-09-25: Orca reads a MISSING key as
  // "launch with the defaults", which are the skip-permissions flags
  // (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`),
  // and an EMPTY one as "no flags", which is how its ask-permissions mode is
  // saved. Deleting a key our strip had emptied turned permission prompts off
  // for every Windows user in ask mode, on their next connect, by itself.
  it('keeps an agent asking for permission when the flag comes out, instead of handing it the skip-permissions default', async () => {
    for (const [hostPlatform, enabled] of [
      ['win32', true],
      ['darwin', false]
    ] as const) {
      const flagOnly = {
        claude: agentHudLaunchFlag('claude', hostPlatform),
        codex: agentHudLaunchFlag('codex', hostPlatform)
      }
      const host = fakeHost(flagOnly, hostPlatform)
      await syncAgentHudDesktopLaunchArgs(host.client, enabled)
      expect(host.stored()).toEqual({ claude: '', codex: '' })
      expect(resolveTuiAgentLaunchArgs('claude', host.stored())).toBe('')
      expect(resolveTuiAgentLaunchArgs('codex', host.stored())).toBe('')
    }
  })

  it('keeps what Orca would launch an agent with when it has no saved args, flag in and flag out', async () => {
    const host = fakeHost({}, 'darwin')
    await syncAgentHudDesktopLaunchArgs(host.client, true)
    expect(host.stored().claude).toBe(`${getTuiAgentDefaultArgs('claude')} ${agentHudLaunchFlag('claude', 'darwin')}`)
    await syncAgentHudDesktopLaunchArgs(host.client, false)
    expect(resolveTuiAgentLaunchArgs('claude', host.stored())).toBe(getTuiAgentDefaultArgs('claude'))
    expect(resolveTuiAgentLaunchArgs('codex', host.stored())).toBe(getTuiAgentDefaultArgs('codex'))
  })

  // Same review: a failed `status.get` read as "not Windows", so the sync put
  // the POSIX flag, with the same double-quoted JSON PowerShell 5.1 breaks,
  // straight back onto the Windows host it had just cleaned.
  it('touches nothing when the host will not say what platform it is', async () => {
    const saved = { claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}` }
    for (const hostPlatform of ['rejects', null] as const) {
      for (const enabled of [true, false]) {
        const host = fakeHost(saved, hostPlatform)
        expect(await syncAgentHudDesktopLaunchArgs(host.client, enabled)).toBeNull()
        expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
        expect(host.stored()).toEqual(saved)
      }
    }
  })

  it('gives the profile back exactly as it was when the switch is turned off', async () => {
    const host = fakeHost({
      claude: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: agentHudLaunchFlag('codex', 'darwin')
    })
    expect(await syncAgentHudDesktopLaunchArgs(host.client, false)).toEqual({ claude: '--verbose', codex: '' })
    // codex had nothing but our flag, so it goes back to launching with none,
    // not to Orca's defaults, which a missing key would mean.
    expect(host.stored()).toEqual({ claude: '--verbose', codex: '' })
  })
})
