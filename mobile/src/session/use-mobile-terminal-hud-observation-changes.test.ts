import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// The hook keeps the last observation when a poll reads the same thing, so an
// idle screen re-renders nothing. It used to decide "the same" from six fields
// (model, effort, label, permission mode, context percent and used label) and
// threw away a poll that changed anything else. So the Codex mode pill stayed
// on Default after the footer turned Plan mode on, and the task row kept
// counting shells Claude's footer said had finished (review, 2026-09-30).

/** Each screen of a capture under fixtures/, after its `=== screen: … ===` line. */
function readScreens(file: string): Record<string, string[]> {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
  const screens: Record<string, string[]> = {}
  let current: string[] | null = null
  for (const row of text.split('\n')) {
    const marker = /^=== screen: (.*) ===$/.exec(row)
    if (marker) {
      current = screens[marker[1]!] = []
    } else {
      current?.push(row)
    }
  }
  return screens
}

// Codex's input footer. Default paints the row alone; Plan adds the hint at
// its right edge (the Plan row is the one mobile-terminal-hud-parse.test.ts
// reads; the build it came from is not recorded with it). codex-cli 0.153.4
// paints the model row this way (live capture, 2026-09-09).
const CODEX_DEFAULT = ['› Ask Codex to do anything', '  gpt-5.6-sol medium · ~/Project']
const CODEX_PLAN = [
  '› Ask Codex to do anything',
  '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
]

// Claude Code 2.1.277's status area, verbatim from the frame read on
// 2026-09-19 (`orca terminal read --screen`, mobile-terminal-queued-messages
// .test.ts), with one shell running. The same build's desk footer at two
// shells, 2026-09-20, is quoted in mobile-background-tasks-footer-count.test.ts.
const CLAUDE_STATUS_2_1_277 = [
  '────────────────────────────────────────────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────',
  '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1'
]
const CLAUDE_TWO_SHELLS = [...CLAUDE_STATUS_2_1_277, '⏵⏵ auto mode on · 2 shells · ← for agents']
const CLAUDE_ONE_SHELL = [...CLAUDE_STATUS_2_1_277, '  ⏵⏵ auto mode on · 1 shell · ← for agents']

// Claude Code 2.1.282 (tmux, 2026-09-25): two sessions after their question
// was answered, the same status area under a different spinner verb.
const BLOVIATING_2_1_282 = readScreens('claude-screen-ask-two-questions-2.1.282.txt')['after Enter']!
const COMPOSING_2_1_282 = readScreens('claude-screen-ask-multi-select-2.1.282.txt')['after Enter']!

const reply = (lines: string[]) => ({ ok: true, result: { terminal: { source: 'screen', lines } } })

let renderer: ReactTestRenderer | null = null
let hud: ReturnType<typeof useMobileTerminalHudObservation>
let renders = 0
const handleRef = { current: 'terminal' }

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  renders = 0
  vi.useRealTimers()
})

/** Mounts the hook on an idle tab (one poll every 5 s) over `sendRequest`. */
async function mount(agent: 'claude' | 'codex', sendRequest: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers()
  const client = { sendRequest } as unknown as RpcClient
  function Harness() {
    renders += 1
    hud = useMobileTerminalHudObservation({
      client,
      enabled: true,
      active: false,
      handleRef,
      handleKey: 'terminal',
      agent
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
}

async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
}

describe('the screen observation after the footer changes', () => {
  it('moves the Codex mode pill to Plan when the footer turns Plan mode on and nothing else changes', async () => {
    const sendRequest = vi.fn().mockResolvedValue(reply(CODEX_DEFAULT))
    await mount('codex', sendRequest)
    expect(hud.observation?.agentMode).toBe('default')

    sendRequest.mockResolvedValue(reply(CODEX_PLAN))
    await nextPoll()

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation?.agentMode).toBe('plan')

    sendRequest.mockResolvedValue(reply(CODEX_DEFAULT))
    await nextPoll()

    expect(hud.observation?.agentMode).toBe('default')
  })

  it("stops counting a shell once Claude's footer says it has finished", async () => {
    const sendRequest = vi.fn().mockResolvedValue(reply(CLAUDE_TWO_SHELLS))
    await mount('claude', sendRequest)
    expect(hud.observation?.runningShellCount).toBe(2)

    sendRequest.mockResolvedValue(reply(CLAUDE_ONE_SHELL))
    await nextPoll()

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation?.runningShellCount).toBe(1)
  })

  it('holds what the latest screen says, field for field, when only the spinner verb moved', async () => {
    const sendRequest = vi.fn().mockResolvedValue(reply(BLOVIATING_2_1_282))
    await mount('claude', sendRequest)
    expect(hud.observation).toEqual(parseTerminalHudObservation(BLOVIATING_2_1_282))
    expect(hud.observation?.activity).toBe('Bloviating')

    sendRequest.mockResolvedValue(reply(COMPOSING_2_1_282))
    await nextPoll()

    expect(hud.observation).toEqual(parseTerminalHudObservation(COMPOSING_2_1_282))
    expect(hud.observation?.activity).toBe('Composing')
  })
})

describe('the screen observation while the footer holds still', () => {
  it.each([
    ['claude', CLAUDE_ONE_SHELL],
    ['codex', CODEX_PLAN]
  ] as const)('re-renders nothing when a %s poll reads the same screen again', async (agent, screen) => {
    const sendRequest = vi.fn().mockResolvedValue(reply(screen))
    await mount(agent, sendRequest)
    const first = hud.observation
    expect(first).not.toBeNull()
    // React may render once more after the render that took the first read
    // before it bails out of same-value updates; count from after that one.
    await nextPoll()
    const rendersBefore = renders

    await nextPoll()
    await nextPoll()

    expect(sendRequest).toHaveBeenCalledTimes(4)
    expect(hud.observation).toBe(first)
    expect(renders).toBe(rendersBefore)
  })

  it.each([
    ['the read is rejected', () => Promise.reject(new Error('relay closed'))],
    ['the host declines the read', () => Promise.resolve({ ok: false, error: { message: 'no such terminal' } })],
    ['the screen comes back empty', () => Promise.resolve(reply([]))],
    ['the screen is one blank row', () => Promise.resolve(reply(['']))]
  ])('keeps the last observation when %s', async (_why, next) => {
    const sendRequest = vi.fn().mockResolvedValue(reply(CLAUDE_ONE_SHELL))
    await mount('claude', sendRequest)
    const held = hud.observation
    expect(held?.runningShellCount).toBe(1)

    sendRequest.mockImplementation(next)
    await nextPoll()

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation).toBe(held)
  })

  it('reads a one-row Codex footer after an empty first screen', async () => {
    const sendRequest = vi.fn().mockResolvedValue(reply([]))
    await mount('codex', sendRequest)
    expect(hud.observation).toBeNull()

    sendRequest.mockResolvedValue(reply([CODEX_PLAN[1]!]))
    await nextPoll()

    expect(hud.observation).toMatchObject({ modelId: 'gpt-5.6-sol', agentMode: 'plan' })
  })
})
