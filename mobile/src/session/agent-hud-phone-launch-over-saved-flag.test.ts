import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { withAgentHudDesktopFlag } from './agent-hud-desktop-launch-args'
import { agentHudLaunchFlag, buildAgentHudLaunchArgs } from './agent-hud-launch-args'
import { resolveAgentHudLaunchConfig } from './agent-hud-launch-config'
import { readHudLaunchFlags } from './agent-hud-launch-flag-owner'

// With the desktop HUD switch on, Orca's saved default args already end in our beacon flag. A tab
// the phone opened appended a second copy (two --settings for Claude, two -c notify= for Codex):
// buildAgentHudLaunchArgs read the saved flags but only for a refusal, and never took ours out, where
// the desktop sync replaces rather than stacks (review, 2026-09-30).

type HistoricalFlag = { build: string; commit: string; agent: 'claude' | 'codex'; hostPlatform: string; flag: string }
/** Flags earlier builds saved in Orca's `agentDefaultArgs`, byte for byte (the fixture's `about`). */
const history = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/agent-hud-desktop-flags-history.json', import.meta.url)), 'utf8')
  ) as { flags: HistoricalFlag[] }
).flags
const historical = (commit: string, agent: 'claude' | 'codex'): string =>
  history.find((entry) => entry.commit === commit && entry.agent === agent && entry.hostPlatform === 'darwin')!.flag

/** How many flags of ours the args carry, read the way Orca splits them. */
function oursIn(agent: 'claude' | 'codex', args: string, hostPlatform: NodeJS.Platform): number {
  const flags = readHudLaunchFlags(agent, args, hostPlatform)
  return flags.readable ? flags.ours.length : -1
}

function fakeHost(agentDefaultArgs: Record<string, string>, hostPlatform: string) {
  const sendRequest = vi.fn(async (method: string) =>
    method === 'settings.get'
      ? { ok: true, result: { agentDefaultArgs, agentDefaultEnv: {} } }
      : { ok: true, result: { hostPlatform } }
  )
  return { sendRequest } as unknown as RpcClient
}

const CASES = [
  ['claude', 'darwin'],
  ['claude', 'linux'],
  ['codex', 'darwin'],
  ['codex', 'linux']
] as const

describe('a tab the phone opens over a profile the desktop sync already flagged', () => {
  it.each(CASES)('starts %s on %s with one beacon flag, not two', (agent, hostPlatform) => {
    const once = withAgentHudDesktopFlag(agent, '--foo bar', hostPlatform)
    expect(oursIn(agent, once, hostPlatform)).toBe(1)
    const launched = buildAgentHudLaunchArgs({ agent, hostDefaultArgs: once, hostPlatform })
    expect(launched).toBe(once)
    expect(oursIn(agent, launched!, hostPlatform)).toBe(1)
  })

  it.each(CASES)('launches %s on %s exactly as saved when the saved args already carry the flag', async (agent, hostPlatform) => {
    const once = withAgentHudDesktopFlag(agent, '--foo bar', hostPlatform)
    expect(await resolveAgentHudLaunchConfig(fakeHost({ [agent]: once }, hostPlatform), agent)).toBeNull()
    // And args that are only our flag.
    const alone = agentHudLaunchFlag(agent, hostPlatform)
    expect(buildAgentHudLaunchArgs({ agent, hostDefaultArgs: alone, hostPlatform })).toBe(alone)
    expect(await resolveAgentHudLaunchConfig(fakeHost({ [agent]: alone }, hostPlatform), agent)).toBeNull()
  })

  it.each([
    ['0.2.77 (6b255d84)', '6b255d84'],
    ['0.2.81 (63ffa716)', '63ffa716']
  ])("replaces the flag an older build, %s, saved with the current one, keeping the user's args", (_build, commit) => {
    for (const agent of ['claude', 'codex'] as const) {
      const saved = `--verbose ${historical(commit, agent)}`
      expect(buildAgentHudLaunchArgs({ agent, hostDefaultArgs: saved, hostPlatform: 'darwin' })).toBe(
        `--verbose ${agentHudLaunchFlag(agent, 'darwin')}`
      )
    }
  })

  it('adds the flag to empty saved args, and still adds none on Windows', () => {
    expect(buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: '', hostPlatform: 'darwin' })).toBe(
      agentHudLaunchFlag('codex', 'darwin')
    )
    const once = withAgentHudDesktopFlag('claude', '--foo bar', 'darwin')
    expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: once, hostPlatform: 'win32' })).toBeNull()
    expect(buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: '', hostPlatform: 'win32' })).toBeNull()
  })

  it("still refuses args it cannot split, and the user's own --settings beside a flag of ours, each with its line", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const flag = agentHudLaunchFlag('claude', 'darwin')
      expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: `--foo 'open ${flag}`, hostPlatform: 'darwin' })).toBeNull()
      const theirs = `--settings '{"statusLine":{"type":"command","command":"~/bar.sh"}}'`
      expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: `${theirs} ${flag}`, hostPlatform: 'darwin' })).toBeNull()
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[hud-launch-args\] claude: .*do not split/),
        expect.stringMatching(/^\[hud-launch-args\] claude: .*--settings/)
      ])
    } finally {
      warn.mockRestore()
    }
  })
})
