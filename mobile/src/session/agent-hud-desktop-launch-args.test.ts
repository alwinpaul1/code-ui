import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { getTuiAgentDefaultArgs, resolveTuiAgentLaunchArgs } from '../../../src/shared/tui-agent-launch-defaults'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'
import {
  syncAgentHudDesktopLaunchArgs,
  withAgentHudDesktopFlag,
  withoutAgentHudDesktopFlag,
  withoutStaleWindowsHudFlag
} from './agent-hud-desktop-launch-args'

type HistoricalFlag = { build: string; commit: string; agent: 'claude' | 'codex'; hostPlatform: string; flag: string }

/** Flags earlier builds saved in Orca's `agentDefaultArgs`, byte for byte,
 *  replayed from the source at each commit (see the file's `about`). */
const history = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/agent-hud-desktop-flags-history.json', import.meta.url)), 'utf8')
  ) as { flags: HistoricalFlag[] }
).flags
const historical = (commit: string, agent: 'claude' | 'codex', hostPlatform: string): string =>
  history.find((entry) => entry.commit === commit && entry.agent === agent && entry.hostPlatform === hostPlatform)!.flag

// 0.2.77 wrote these into Orca's launch profile for a few hours on 2026-09-09.
// They put a visible row in the user's terminals; every later build removes them.
// The exact text that build wrote (6b255d84): until 2026-09-30 these were
// paraphrases, and the Codex one, a two-item footer 0.2.77 never wrote, is
// one a user can write for themselves.
const oldClaudeFlag = historical('6b255d84', 'claude', 'darwin')
const oldCodexFlag = historical('6b255d84', 'codex', 'darwin')

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
    // Writing the new flag must not leave the old visible one behind either.
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

    const written = await syncAgentHudDesktopLaunchArgs(host.client)
    expect(written).toEqual({
      claude: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: `${getTuiAgentDefaultArgs('codex')} ${agentHudLaunchFlag('codex', 'darwin')}`
    })
    expect(host.sendRequest.mock.calls.map(([m]) => m)).toContain('settings.update')

    host.sendRequest.mockClear()
    expect(await syncAgentHudDesktopLaunchArgs(host.client)).toBeNull()
    expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
  })

  // 2026-09-25, a Windows user: every Claude launch failed with "Error:
  // Invalid JSON provided to --settings". Windows PowerShell 5.1 strips the
  // double quotes inside an argument it hands a native program, so the
  // settings JSON reached Claude Code without them. The Windows path had never
  // run on Windows. Until an encoding survives 5.1, a Windows host gets no flag.
  it('writes no beacon flag to a Windows host', async () => {
    const host = fakeHost({}, 'win32')
    expect(await syncAgentHudDesktopLaunchArgs(host.client)).toBeNull()
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
    const written = await syncAgentHudDesktopLaunchArgs(host.client)
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
    for (const hostPlatform of ['win32'] as const) {
      const flagOnly = {
        claude: agentHudLaunchFlag('claude', hostPlatform),
        codex: agentHudLaunchFlag('codex', hostPlatform)
      }
      const host = fakeHost(flagOnly, hostPlatform)
      await syncAgentHudDesktopLaunchArgs(host.client)
      expect(host.stored()).toEqual({ claude: '', codex: '' })
      expect(resolveTuiAgentLaunchArgs('claude', host.stored())).toBe('')
      expect(resolveTuiAgentLaunchArgs('codex', host.stored())).toBe('')
    }
  })

  it('keeps what Orca would launch an agent with when it has no saved args, flag in and flag out', async () => {
    const host = fakeHost({}, 'darwin')
    await syncAgentHudDesktopLaunchArgs(host.client)
    expect(host.stored().claude).toBe(`${getTuiAgentDefaultArgs('claude')} ${agentHudLaunchFlag('claude', 'darwin')}`)
    expect(withoutAgentHudDesktopFlag('claude', host.stored().claude)).toBe(getTuiAgentDefaultArgs('claude'))
    expect(withoutAgentHudDesktopFlag('codex', host.stored().codex)).toBe(getTuiAgentDefaultArgs('codex'))
  })

  // Same review: a failed `status.get` read as "not Windows", so the sync put
  // the POSIX flag, with the same double-quoted JSON PowerShell 5.1 breaks,
  // straight back onto the Windows host it had just cleaned.
  it('touches nothing when the host will not say what platform it is', async () => {
    const saved = { claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}` }
    for (const hostPlatform of ['rejects', null] as const) {
      const host = fakeHost(saved, hostPlatform)
      expect(await syncAgentHudDesktopLaunchArgs(host.client)).toBeNull()
      expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
      expect(host.stored()).toEqual(saved)
    }
  })

  it('gives a Windows profile back exactly as it was without our flag', async () => {
    const host = fakeHost(
      {
        claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}`,
        codex: agentHudLaunchFlag('codex', 'win32')
      },
      'win32'
    )
    expect(await syncAgentHudDesktopLaunchArgs(host.client)).toEqual({ claude: '--verbose', codex: '' })
    // codex had nothing but our flag, so it goes back to launching with none,
    // not to Orca's defaults, which a missing key would mean.
    expect(host.stored()).toEqual({ claude: '--verbose', codex: '' })
  })
})

// Review of 2026-09-30: the flags were recognised by SHAPE, so a user's own
// `--settings '{"statusLine":…}'`, `-c 'notify=[…]'` or
// `-c 'tui.status_line=[…]'` in Orca's launch profile was deleted from their
// desktop settings by the next connect, and never came back.
// Our Codex notify only delegates to a notify in config.toml, so a `-c` one
// was simply gone: no more completion notifications.
const userClaudeBar = `--settings '{"statusLine":{"type":"command","command":"~/bar.sh"}}'`
const userCodexFooter = `-c 'tui.status_line=["model","git-branch"]'`
const userCodexNotify = `-c 'notify=["terminal-notifier","-message","codex done"]'`

describe("the user's own launch flags stay theirs", () => {
  it("keeps the user's own Claude status line and Codex footer ", () => {
    expect(withoutAgentHudDesktopFlag('claude', userClaudeBar)).toBe(userClaudeBar)
    expect(withoutAgentHudDesktopFlag('codex', userCodexFooter)).toBe(userCodexFooter)
    expect(withoutAgentHudDesktopFlag('codex', `--yolo ${userCodexNotify}`)).toBe(`--yolo ${userCodexNotify}`)
    // The two-item footer the old test used for 0.2.77's is a footer a user
    // can write; 0.2.77 wrote four items (oldCodexFlag).
    const twoItems = `-c 'tui.status_line=["model-with-reasoning","context-remaining"]'`
    expect(withoutAgentHudDesktopFlag('codex', twoItems)).toBe(twoItems)
  })

  it("adds no beacon flag over the user's own notify or --settings, and keeps theirs", () => {
    expect(withAgentHudDesktopFlag('codex', `--yolo ${userCodexNotify}`, 'darwin')).toBe(`--yolo ${userCodexNotify}`)
    expect(withAgentHudDesktopFlag('claude', `--verbose ${userClaudeBar}`, 'darwin')).toBe(`--verbose ${userClaudeBar}`)
    // Claude Code 2.1.285 reads --settings as ONE value (`nKo` takes one
    // string), so ours after any of theirs would replace all of theirs.
    for (const own of [`--settings ~/claude-extra.json`, `--settings='{"model":"opus"}'`, '--settings']) {
      expect(withAgentHudDesktopFlag('claude', own, 'darwin')).toBe(own)
    }
    // A footer is not a notify: the beacon still goes on beside it.
    expect(withAgentHudDesktopFlag('codex', userCodexFooter, 'darwin')).toBe(
      `${userCodexFooter} ${agentHudLaunchFlag('codex', 'darwin')}`
    )
  })

  it("takes out a flag of ours that sits over the user's own, and adds none back", () => {
    const stacked = `--verbose ${userClaudeBar} ${agentHudLaunchFlag('claude', 'darwin')}`
    expect(withAgentHudDesktopFlag('claude', stacked, 'darwin')).toBe(`--verbose ${userClaudeBar}`)
    expect(withoutAgentHudDesktopFlag('claude', stacked)).toBe(`--verbose ${userClaudeBar}`)
    const codex = `${userCodexNotify} ${agentHudLaunchFlag('codex', 'darwin')}`
    expect(withAgentHudDesktopFlag('codex', codex, 'darwin')).toBe(userCodexNotify)
  })

  it('still takes out every flag an earlier build saved, on each host it wrote to', () => {
    const everyFlag = [
      ...history.map((entry) => ({ agent: entry.agent, flag: entry.flag })),
      ...(['darwin', 'linux', 'win32'] as const).flatMap((hostPlatform) =>
        (['claude', 'codex'] as const).map((agent) => ({ agent, flag: agentHudLaunchFlag(agent, hostPlatform) }))
      )
    ]
    for (const { agent, flag } of everyFlag) {
      expect(withoutAgentHudDesktopFlag(agent, `--verbose ${flag}`)).toBe('--verbose')
      expect(withoutAgentHudDesktopFlag(agent, flag)).toBe('')
      expect(withAgentHudDesktopFlag(agent, `--verbose ${flag}`, 'darwin')).toBe(
        `--verbose ${agentHudLaunchFlag(agent, 'darwin')}`
      )
    }
  })

  it('leaves a profile with no flag of ours exactly as it is, spacing and all', async () => {
    for (const saved of ['', '  --verbose  ', userClaudeBar]) {
      expect(withoutAgentHudDesktopFlag('claude', saved)).toBe(saved)
    }
    expect(withoutAgentHudDesktopFlag('codex', undefined)).toBe('')
    const host = fakeHost({ claude: '  --verbose  ', codex: `--search ${userCodexFooter}` }, 'win32')
    expect(await syncAgentHudDesktopLaunchArgs(host.client)).toBeNull()
    expect(host.sendRequest.mock.calls.map(([m]) => m)).not.toContain('settings.update')
  })

  it('touches nothing in arguments it cannot split the way Orca does', () => {
    const unclosed = `--verbose "unclosed ${agentHudLaunchFlag('claude', 'darwin')}`
    expect(withoutAgentHudDesktopFlag('claude', unclosed)).toBe(unclosed)
    expect(withAgentHudDesktopFlag('claude', unclosed, 'darwin')).toBe(unclosed)
  })

  it("round-trips a profile with the user's flags and 0.2.77's, and says once per connect why an agent got no beacon", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const host = fakeHost({
        claude: `--verbose ${userClaudeBar} ${oldClaudeFlag}`,
        codex: `--search ${userCodexFooter} ${oldCodexFlag} ${userCodexNotify}`
      })
      await syncAgentHudDesktopLaunchArgs(host.client)
      expect(host.stored()).toEqual({
        claude: `--verbose ${userClaudeBar}`,
        codex: `--search ${userCodexFooter} ${userCodexNotify}`
      })
      const lines = warn.mock.calls.map((call) => String(call[0]))
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatch(/^\[hud-desktop-args\] claude: .*--settings/)
      expect(lines[1]).toMatch(/^\[hud-desktop-args\] codex: .*notify/)

      warn.mockClear()
      expect(await syncAgentHudDesktopLaunchArgs(host.client)).toBeNull()
      expect(host.stored()).toEqual({
        claude: `--verbose ${userClaudeBar}`,
        codex: `--search ${userCodexFooter} ${userCodexNotify}`
      })
      // Said again on each new connection, never more than once per agent.
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(lines)
    } finally {
      warn.mockRestore()
    }
  })

  it('round-trips a profile of the user\'s own arguments: the flag on, then exactly theirs back', async () => {
    const saved = { claude: `--verbose --add-dir "$HOME/notes"`, codex: `--search ${userCodexFooter}` }
    const host = fakeHost(saved)
    await syncAgentHudDesktopLaunchArgs(host.client)
    expect(host.stored()).toEqual({
      claude: `${saved.claude} ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: `${saved.codex} ${agentHudLaunchFlag('codex', 'darwin')}`
    })
    expect(withoutAgentHudDesktopFlag('claude', host.stored().claude!)).toBe(saved.claude)
    expect(withoutAgentHudDesktopFlag('codex', host.stored().codex!)).toBe(saved.codex)
  })

  it("keeps the user's own flags on a Windows host while taking ours out, and writes none", async () => {
    const host = fakeHost(
      {
        claude: `${userClaudeBar} ${agentHudLaunchFlag('claude', 'win32')}`,
        codex: `${userCodexNotify} ${historical('63ffa716', 'codex', 'win32')}`
      },
      'win32'
    )
    await syncAgentHudDesktopLaunchArgs(host.client)
    expect(host.stored()).toEqual({ claude: userClaudeBar, codex: userCodexNotify })
    // What a launch there starts with before that write lands.
    expect(withoutStaleWindowsHudFlag('codex', `${userCodexFooter} ${agentHudLaunchFlag('codex', 'win32')}`, 'win32')).toBe(
      userCodexFooter
    )
    expect(withoutStaleWindowsHudFlag('codex', userCodexFooter, 'win32')).toBe(userCodexFooter)
  })
})
