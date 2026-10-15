import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  resetRemoteControlPreferenceMemoryForTests,
  saveRemoteControlNewSessions
} from '../storage/remote-control-preference'
import { agentHudLaunchFlag } from './agent-hud-launch-args'
import { resolveAgentHudLaunchConfig } from './agent-hud-launch-config'
import { withRemoteControlFlag } from './agent-remote-control-launch-args'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiGet: vi.fn() }
}))

// 2026-10-15: "make all sessions from our system have RC on by default and it must be in
// settings, on". Claude Code 2.1.300: `--remote-control [name]`. The flag takes an optional
// NAME, and Orca appends the prompt to the args as a bare word, so the flag must never be last.

function fakeHost(agentDefaultArgs: Record<string, string>, hostPlatform: string) {
  const sendRequest = vi.fn(async (method: string) =>
    method === 'settings.get'
      ? { ok: true, result: { agentDefaultArgs, agentDefaultEnv: {} } }
      : { ok: true, result: { hostPlatform } }
  )
  return { sendRequest } as unknown as RpcClient
}

describe('withRemoteControlFlag', () => {
  const base = { agent: 'claude' as const, hostPlatform: 'darwin' as const, enabled: true }

  it('puts the flag in front of the args, so a prompt appended after them is not its name', () => {
    expect(withRemoteControlFlag({ ...base, agentArgs: '--verbose --settings x' })).toBe(
      '--remote-control --verbose --settings x'
    )
  })

  it('adds nothing when the switch is off', () => {
    expect(withRemoteControlFlag({ ...base, agentArgs: '--verbose', enabled: false })).toBe('--verbose')
  })

  it('adds nothing on a Windows host or one that will not say what it is', () => {
    expect(withRemoteControlFlag({ ...base, agentArgs: '--verbose', hostPlatform: 'win32' })).toBe('--verbose')
    expect(withRemoteControlFlag({ ...base, agentArgs: '--verbose', hostPlatform: null })).toBe('--verbose')
  })

  it('does not stack a second flag on args that already carry it, in either spelling', () => {
    expect(withRemoteControlFlag({ ...base, agentArgs: '--verbose --remote-control' })).toBe(
      '--verbose --remote-control'
    )
    expect(withRemoteControlFlag({ ...base, agentArgs: '--remote-control=mine --verbose' })).toBe(
      '--remote-control=mine --verbose'
    )
  })

  it('is for Claude only', () => {
    expect(withRemoteControlFlag({ ...base, agent: 'codex', agentArgs: '--verbose' })).toBe('--verbose')
  })

  it('refuses rather than guess when no flag of the args can stand after it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(withRemoteControlFlag({ ...base, agentArgs: '' })).toBe('')
    expect(withRemoteControlFlag({ ...base, agentArgs: 'resume-word --verbose' })).toBe('resume-word --verbose')
    expect(withRemoteControlFlag({ ...base, agentArgs: "--settings 'unclosed" })).toBe("--settings 'unclosed")
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

describe('a Claude tab the phone opens', () => {
  beforeEach(() => {
    resetRemoteControlPreferenceMemoryForTests()
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with Remote Control, in front of the beacon flag, when nothing was ever switched', async () => {
    const config = await resolveAgentHudLaunchConfig(fakeHost({ claude: '--verbose' }, 'darwin'), 'claude')
    expect(config?.agentArgs).toBe(`--remote-control --permission-mode auto --verbose ${agentHudLaunchFlag('claude', 'darwin')}`)
  })

  it('starts without it once the switch is off, and the beacon flag stays', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('off')
    const config = await resolveAgentHudLaunchConfig(fakeHost({ claude: '--verbose' }, 'darwin'), 'claude')
    expect(config?.agentArgs).toBe(`--permission-mode auto --verbose ${agentHudLaunchFlag('claude', 'darwin')}`)
  })

  it('follows a switch flipped this session without a reload', async () => {
    await saveRemoteControlNewSessions(false)
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('off') // what the write stored
    const config = await resolveAgentHudLaunchConfig(fakeHost({ claude: '--verbose' }, 'darwin'), 'claude')
    expect(config?.agentArgs).not.toContain('--remote-control')
  })

  it('still gets Remote Control when the switch cannot be read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('disk'))
    const config = await resolveAgentHudLaunchConfig(fakeHost({ claude: '--verbose' }, 'darwin'), 'claude')
    expect(config?.agentArgs).toContain('--remote-control')
  })

  it('does not stack a flag the host profile already carries', async () => {
    const config = await resolveAgentHudLaunchConfig(
      fakeHost({ claude: '--verbose --remote-control' }, 'linux'),
      'claude'
    )
    expect(config?.agentArgs?.match(/--remote-control/g)).toHaveLength(1)
  })

  it('on a Windows host launches as the desktop would: no Remote Control flag', async () => {
    expect(await resolveAgentHudLaunchConfig(fakeHost({ claude: '--verbose' }, 'win32'), 'claude')).toBeNull()
  })

  it('leaves a Codex tab alone', async () => {
    const config = await resolveAgentHudLaunchConfig(fakeHost({ codex: '' }, 'darwin'), 'codex')
    expect(config?.agentArgs).not.toContain('--remote-control')
  })

  it('saves nothing on the host: the desktop profile is not written', async () => {
    const client = fakeHost({ claude: '--verbose' }, 'darwin')
    await resolveAgentHudLaunchConfig(client, 'claude')
    const methods = vi.mocked(client.sendRequest).mock.calls.map((call) => call[0])
    expect(methods).not.toContain('settings.update')
  })
})
