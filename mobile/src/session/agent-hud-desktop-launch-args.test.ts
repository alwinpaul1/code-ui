import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  syncAgentHudDesktopLaunchArgs,
  withoutAgentHudDesktopFlag
} from './agent-hud-desktop-launch-args'

const claudeFlag = `--settings '{"statusLine":{"type":"command","command":"i=$(cat); printf x"}}'`
const codexFlag = `-c 'tui.status_line=["model-with-reasoning","context-remaining"]'`

// 0.2.77 wrote these into Orca's launch profile for a few hours on 2026-09-09.
// They put a line in the user's terminals; every later build removes them.
describe('cleanup of the 0.2.77 launch-profile flags', () => {
  it('removes exactly our flags and leaves the user\'s arguments as they were', () => {
    expect(withoutAgentHudDesktopFlag('claude', `--verbose ${claudeFlag}`)).toBe('--verbose')
    expect(withoutAgentHudDesktopFlag('codex', `--search ${codexFlag}`)).toBe('--search')
    expect(withoutAgentHudDesktopFlag('claude', '--dangerously-skip-permissions')).toBe(
      '--dangerously-skip-permissions'
    )
  })

  it('writes once when a host still carries them, and never again after that', async () => {
    let stored: Record<string, string> = { claude: `--verbose ${claudeFlag}`, codex: codexFlag }
    const sendRequest = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'settings.get') {
        return { ok: true, result: { agentDefaultArgs: { ...stored } } }
      }
      stored = { ...(params as { agentDefaultArgs: Record<string, string> }).agentDefaultArgs }
      return { ok: true, result: {} }
    })
    const client = { sendRequest } as unknown as RpcClient

    const written = await syncAgentHudDesktopLaunchArgs(client, false)
    expect(written).toEqual({ claude: '--verbose' })
    expect(sendRequest.mock.calls.map(([m]) => m)).toEqual(['settings.get', 'settings.update'])

    sendRequest.mockClear()
    expect(await syncAgentHudDesktopLaunchArgs(client, false)).toBeNull()
    expect(sendRequest.mock.calls.map(([m]) => m)).toEqual(['settings.get'])
  })
})
