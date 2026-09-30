import { describe, expect, it, vi } from 'vitest'
import { agentHudLaunchFlag, buildAgentHudLaunchArgs } from './agent-hud-launch-args'

// Review of 2026-09-30, the phone's side of the desktop sync's defect: a tab
// the phone opens starts with the host's own args and ours appended. Claude
// Code 2.1.285 reads --settings as ONE value (`nKo` takes one string) and a
// later Codex `-c notify=` replaces an earlier one, so ours replaced the
// user's own status line settings or notify for every tab the phone opened.
const userClaudeBar = `--settings '{"statusLine":{"type":"command","command":"~/bar.sh"}}'`
const userCodexNotify = `-c 'notify=["terminal-notifier","-message","codex done"]'`
const userCodexFooter = `-c 'tui.status_line=["model","git-branch"]'`

describe('a tab the phone opens keeps the user\'s own launch flags', () => {
  it("launches as the desktop would when the user passes their own --settings or notify", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: `--verbose ${userClaudeBar}`, hostPlatform: 'darwin' })).toBeNull()
      expect(buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: userCodexNotify, hostPlatform: 'linux' })).toBeNull()
      // One line each, saying why the tab has no HUD.
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[hud-launch-args\] claude: .*--settings/),
        expect.stringMatching(/^\[hud-launch-args\] codex: .*notify/)
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('still adds the beacon beside a footer, beside no args, and over a flag of ours', () => {
    expect(buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: userCodexFooter, hostPlatform: 'darwin' })).toBe(
      `${userCodexFooter} ${agentHudLaunchFlag('codex', 'darwin')}`
    )
    expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '', hostPlatform: 'darwin' })).toBe(
      agentHudLaunchFlag('claude', 'darwin')
    )
    // The desktop sync's own flag in the profile is not the user's.
    expect(
      buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: agentHudLaunchFlag('claude', 'darwin'), hostPlatform: 'darwin' })
    ).not.toBeNull()
  })
})
