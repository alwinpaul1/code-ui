import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'
import { resolveAgentHudLaunchConfig } from './agent-hud-launch-config'
import { buildMobileAiVaultResumeLaunch } from './ai-vault-resume-launch'
import {
  typedClaudeLaunchWithAutoPermissionMode,
  withAutoPermissionModeForTypedClaudeLaunch,
  withClaudeAutoPermissionMode
} from './claude-auto-permission-mode'
import type { MobileSessionTab } from './mobile-session-route-types'

// The user, 2026-10-15: "Any session opened with selecting claude or typing claude or
// claudeai in terminal must always start with auto mode permission no matter what."
// Flag and modes verified against Claude Code 2.1.300's installed binary.

function fakeHost(agentDefaultArgs: Record<string, string>, hostPlatform: string): RpcClient {
  const sendRequest = vi.fn(async (method: string) =>
    method === 'settings.get'
      ? { ok: true, result: { agentDefaultArgs, agentDefaultEnv: {} } }
      : { ok: true, result: { hostPlatform } }
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolveAgentHudLaunchConfig only calls sendRequest.
  return { sendRequest } as unknown as RpcClient
}

describe('New Tab → Claude starts in auto permission mode', () => {
  it('a Claude tab on Orca’s own default (bypass) starts in auto instead', async () => {
    // Orca's default args for Claude are `--dangerously-skip-permissions` (YOLO_TUI_AGENT_ARGS).
    const client = fakeHost({ claude: '--dangerously-skip-permissions' }, 'darwin')
    const config = await resolveAgentHudLaunchConfig(client, 'claude')
    expect(config?.agentArgs).toBe(
      `--remote-control --permission-mode auto ${agentHudLaunchFlag('claude', 'darwin')}`
    )
  })

  it('a Claude Agent Teams tab starts in auto too, through `orca claude-teams`', async () => {
    const client = fakeHost({ 'claude-agent-teams': '--dangerously-skip-permissions' }, 'darwin')
    expect(await resolveAgentHudLaunchConfig(client, 'claude-agent-teams')).toEqual({
      agentArgs: '--permission-mode auto',
      agentEnv: {}
    })
  })

  it('auto wins over a permission mode the host saved, keeping the rest of its args', async () => {
    const client = fakeHost({ claude: '--verbose --permission-mode plan --model opus' }, 'linux')
    const config = await resolveAgentHudLaunchConfig(client, 'claude')
    expect(config?.agentArgs).toBe(
      `--remote-control --verbose --permission-mode auto --model opus ${agentHudLaunchFlag('claude', 'linux')}`
    )
  })

  it('a Codex tab gets no permission flag', async () => {
    const client = fakeHost({ codex: '' }, 'darwin')
    expect((await resolveAgentHudLaunchConfig(client, 'codex'))?.agentArgs).not.toContain('--permission-mode')
  })

  it('a Windows host launches exactly as the desktop would', async () => {
    const client = fakeHost({ claude: '--dangerously-skip-permissions' }, 'win32')
    expect(await resolveAgentHudLaunchConfig(client, 'claude')).toBeNull()
  })

  it('a Claude session resumed from history starts in auto too', () => {
    const launch = buildMobileAiVaultResumeLaunch({
      session: { agent: 'claude', sessionId: 'abc', cwd: '/Users/ada/repo', codexHome: null },
      hostPlatform: 'darwin',
      settings: { agentDefaultArgs: { claude: '--dangerously-skip-permissions' } }
    })
    expect(launch.command).toContain("'--permission-mode' 'auto'")
    expect(launch.command).not.toContain('dangerously')
  })
})

describe('withClaudeAutoPermissionMode', () => {
  const posix = (agentArgs: string) =>
    withClaudeAutoPermissionMode({ agent: 'claude', agentArgs, hostPlatform: 'darwin' })

  it('with no permission flag of the host’s, puts the flag first, and on its own when the args are empty', () => {
    expect(posix('')).toBe('--permission-mode auto')
    expect(posix('   ')).toBe('--permission-mode auto')
    expect(posix('--verbose')).toBe('--permission-mode auto --verbose')
  })

  it('replaces every spelling of a saved permission mode, where it stands', () => {
    expect(posix('--permission-mode=acceptEdits --verbose')).toBe('--permission-mode auto --verbose')
    expect(posix('--permission-mode bypassPermissions')).toBe('--permission-mode auto')
    expect(posix('--dangerously-skip-permissions --permission-mode plan')).toBe('--permission-mode auto')
    // A dangling flag with no value goes too: left in, it would take ours as its value.
    expect(posix('--verbose --permission-mode')).toBe('--verbose --permission-mode auto')
  })

  // Review of 022e1269f: dropping the bypass flag must never leave a flag that takes an OPTIONAL
  // value last, or Orca's appended prompt becomes that flag's value. Claude Code 2.1.300's
  // optional-value options, read from its binary.
  const OPTIONAL_VALUE_FLAGS = [
    '-d',
    '--debug',
    '-r',
    '--resume',
    '-w',
    '--worktree',
    '--remote-control',
    '--rc',
    '--teleport',
    '--from-pr',
    '--prompt-suggestions'
  ]

  it('never leaves an optional-value flag last when it drops the bypass flag', () => {
    expect(posix('--remote-control --dangerously-skip-permissions')).toBe(
      '--remote-control --permission-mode auto'
    )
    expect(posix('--debug --dangerously-skip-permissions')).toBe('--debug --permission-mode auto')
    for (const flag of OPTIONAL_VALUE_FLAGS) {
      const result = posix(`${flag} --dangerously-skip-permissions`)
      expect(result.split(' ').at(-1)).toBe('auto')
    }
  })

  it('keeps Remote Control, put in front afterwards, off the end of the args', async () => {
    // The second probe: `--remote-control --permission-mode auto --debug` would hand the prompt to --debug.
    const client = fakeHost({ claude: '--debug --dangerously-skip-permissions' }, 'darwin')
    const config = await resolveAgentHudLaunchConfig(client, 'claude')
    expect(config?.agentArgs).toBe(
      `--remote-control --debug --permission-mode auto ${agentHudLaunchFlag('claude', 'darwin')}`
    )
    const bare = await resolveAgentHudLaunchConfig(
      fakeHost({ 'claude-agent-teams': '--remote-control --dangerously-skip-permissions' }, 'darwin'),
      'claude-agent-teams'
    )
    expect(bare?.agentArgs).toBe('--remote-control --permission-mode auto')
  })

  it('a bypass flag between an optional-value flag and a bare word keeps the word out of its value', () => {
    expect(posix('--debug --dangerously-skip-permissions api')).toBe('--debug --permission-mode auto api')
  })

  it('leaves args that already start in auto alone', () => {
    expect(posix('--permission-mode auto --verbose')).toBe('--permission-mode auto --verbose')
  })

  it('keeps each kept argument’s own quoting', () => {
    expect(posix(`--dangerously-skip-permissions --settings '{"a": 1}'`)).toBe(
      `--permission-mode auto --settings '{"a": 1}'`
    )
  })

  it('keeps bypass-in-the-cycle and anything after `--`', () => {
    expect(posix('--allow-dangerously-skip-permissions')).toBe(
      '--permission-mode auto --allow-dangerously-skip-permissions'
    )
    expect(posix('-- --dangerously-skip-permissions')).toBe(
      '--permission-mode auto -- --dangerously-skip-permissions'
    )
  })

  it('touches no other agent, and no host that will not say what it is', () => {
    expect(
      withClaudeAutoPermissionMode({ agent: 'codex', agentArgs: '--yolo', hostPlatform: 'darwin' })
    ).toBe('--yolo')
    expect(
      withClaudeAutoPermissionMode({ agent: 'claude', agentArgs: '--verbose', hostPlatform: null })
    ).toBe('--verbose')
  })
})

describe('a claude line typed from the phone', () => {
  it.each([
    ['claude', 'claude --permission-mode auto'],
    ['claudeai', 'claudeai --permission-mode auto'],
    ['claude  ', 'claude  --permission-mode auto'],
    ['claude --model opus', 'claude --model opus --permission-mode auto'],
    ['claudeai --resume abc', 'claudeai --resume abc --permission-mode auto'],
    ['claude -c', 'claude -c --permission-mode auto'],
    ['claude "fix the build"', 'claude "fix the build" --permission-mode auto']
  ])('%j starts in auto', (line, expected) => {
    expect(withAutoPermissionModeForTypedClaudeLaunch(line)).toBe(expected)
  })

  it.each([
    // Already carries a permission flag of the user's own: theirs stands.
    'claude --permission-mode plan',
    'claude --permission-mode=default',
    'claudeai --dangerously-skip-permissions',
    // Not a session.
    'claude --help',
    'claude -v',
    'claude mcp list',
    'claude config get',
    'claude doctor',
    'claude --verbose mcp list',
    'claude somethingnew',
    // Not the launcher.
    'echo claude',
    'claudex',
    'claude-sub',
    '/usr/local/bin/claude',
    '"claude"',
    'FOO=1 claude',
    ' claude',
    // Shell syntax this does not try to understand.
    'claude && ls',
    'claude | tee log',
    'claude --model $MODEL',
    'claude\nclaude',
    'claude -- --verbose',
    // Degenerate.
    '',
    '   '
  ])('%j is sent as typed', (line) => {
    expect(withAutoPermissionModeForTypedClaudeLaunch(line)).toBeNull()
  })
})

describe('which typed lines may be rewritten', () => {
  const shellTab: MobileSessionTab = {
    type: 'terminal',
    id: 'tab-1',
    title: 'zsh',
    terminal: 'terminal-a',
    isActive: true
  }

  it('a shell tab on a macOS or Linux host', () => {
    expect(
      typedClaudeLaunchWithAutoPermissionMode({ line: 'claude', hostPlatform: 'darwin', tab: shellTab })
    ).toBe('claude --permission-mode auto')
    expect(
      typedClaudeLaunchWithAutoPermissionMode({ line: 'claude', hostPlatform: 'linux', tab: shellTab })
    ).toBe('claude --permission-mode auto')
  })

  it('not a pane an agent owns: `claude` typed to a running Claude is a prompt', () => {
    expect(
      typedClaudeLaunchWithAutoPermissionMode({
        line: 'claude',
        hostPlatform: 'darwin',
        tab: { ...shellTab, launchAgent: 'claude' }
      })
    ).toBeNull()
    expect(
      typedClaudeLaunchWithAutoPermissionMode({
        line: 'claude',
        hostPlatform: 'darwin',
        tab: { ...shellTab, launchAgent: 'codex' }
      })
    ).toBeNull()
  })

  it('not a Windows host, a host that has not said, or no terminal tab', () => {
    expect(
      typedClaudeLaunchWithAutoPermissionMode({ line: 'claude', hostPlatform: 'win32', tab: shellTab })
    ).toBeNull()
    expect(
      typedClaudeLaunchWithAutoPermissionMode({ line: 'claude', hostPlatform: null, tab: shellTab })
    ).toBeNull()
    expect(
      typedClaudeLaunchWithAutoPermissionMode({ line: 'claude', hostPlatform: 'darwin', tab: null })
    ).toBeNull()
  })
})
