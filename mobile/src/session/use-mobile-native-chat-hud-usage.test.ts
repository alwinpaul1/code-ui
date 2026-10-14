import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { noteAgentHudBeaconListening } from './agent-hud-beacon-liveness'
import { clearHeldContextReportsForTests } from './use-held-context-report'
import { readClaudeContextReport, type ContextReportRead } from './claude-context-report'
import { parseTerminalHudObservation, type TerminalHudObservation } from './mobile-terminal-hud-parse'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'
import { useMobileNativeChatHud, type NativeChatHudPhase, type NativeChatLiveHud } from './use-mobile-native-chat-hud'

// What the chat HUD hands the banner and the context sheet: the usage windows (from the recorded
// beacon of Claude Code 2.1.296, or the host's feed) and the held `/context` table (Claude Code
// 2.1.300's, fixtures/claude-context-2.1.300/).
const fakes = vi.hoisted(() => ({
  screen: null as TerminalHudObservation | null,
  contextReport: null as ContextReportRead | null,
  accounts: null as unknown
}))
vi.mock('./use-mobile-terminal-hud-observation', () => ({
  useMobileTerminalHudObservation: () => ({
    observation: fakes.screen,
    contextReport: fakes.contextReport,
    refresh: async () => fakes.screen,
    dialogOptions: null,
    terminalPermission: null,
    permissionDismissed: false,
    queuedMessages: [],
    sentPrompts: []
  })
}))
vi.mock('./use-host-rate-limits', () => ({
  useHostAccountsSnapshot: () => fakes.accounts
}))

const ESC = '\u001b'
const BEL = '\u0007'
const HANDLE = 'term_f2fc5afd-cae1-4cc8-ac9e-ee2e28649941'
const RECORDED = readFileSync(
  join(import.meta.dirname, 'fixtures/claude-busy-lead-tasks-2.1.296/beacon-payloads.txt'),
  'utf8'
).split('\n')[0]!
// The session that recorded beacon speaks for.
const RECORDED_SESSION = '15e64a5d-26e7-4d65-9b2d-3ef2f4e1fae8'
const OTHER_SESSION = '8b19cb22-996c-40e5-a887-a5323a9845e1'
const TABLE = readClaudeContextReport(
  readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300/context-130-cols.txt'), 'utf8').split('\n')
)!
const OTHER_TABLE = readClaudeContextReport(
  readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300/context-110-cols-memory-files.txt'), 'utf8').split('\n')
)!
// A status line that states a context figure, so the ring (and with it the sheet) exists.
const STATUS_LINE = [
  '[Opus 5 (1M context) xhigh | Max 20x] ██░░░░░░░░ 22% (217k/1.0M)',
  '',
  '❯ ',
  '  ⏵⏵ accept edits on (shift+tab to cycle)'
]

type Probe = { agent: string | null; sessionId: string | null; phase?: NativeChatHudPhase }
let latest: NativeChatLiveHud | null = null
const handleRef = { current: HANDLE as string | null }
function Harness({ agent, sessionId, phase = 'idle' }: Probe) {
  const hud = useMobileNativeChatHud({
    client: {} as RpcClient,
    enabled: true,
    handleRef,
    scopeKey: 'scope',
    tabId: 'tab-1',
    sessionId,
    agent,
    phase
  })
  latest = hud.live
  return null
}
let renderer: ReactTestRenderer | null = null
function render(probe: Probe): NativeChatLiveHud {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness, probe))
    } else {
      renderer = create(createElement(Harness, probe))
    }
  })
  if (!latest) {
    throw new Error('the harness did not render')
  }
  return latest
}
const beacon = (line: string) =>
  act(() => {
    consumeAgentHudBeacons(HANDLE, `${ESC}]7777;${line}${BEL}`)
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 14, 21, 30))
  resetAgentHudBeacons()
  clearStickyLiveHudForTests()
  clearHeldContextReportsForTests()
  fakes.screen = null
  fakes.contextReport = null
  fakes.accounts = null
  latest = null
  handleRef.current = HANDLE
  act(() => noteAgentHudBeaconListening(HANDLE, true))
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

const hostFeed = (claude: unknown, codex: unknown = null) => ({ rateLimits: { claude, codex } })
const window = (usedPercent: number, windowMinutes: number, resetsAtMs: number) => ({
  usedPercent,
  windowMinutes,
  resetsAt: resetsAtMs,
  resetDescription: null
})

describe('the usage windows the HUD hands the banner', () => {
  it('are the recorded beacon\'s two windows, for the session on screen, with no screen read at all', () => {
    beacon(RECORDED)
    fakes.screen = null
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).limits).toEqual([
      { name: 'Session', usedPercent: 20, resetsAt: 1_791_678_000, windowMinutes: null },
      { name: 'Weekly', usedPercent: 73, resetsAt: 1_791_997_200, windowMinutes: null }
    ])
  })

  it('are the host\'s feed when the beacon names another session, as for a hand-started claude in the same terminal', () => {
    beacon(RECORDED)
    fakes.accounts = hostFeed({
      provider: 'claude',
      session: window(9, 300, 1_791_678_000_000),
      weekly: null,
      updatedAt: 1,
      error: null,
      status: 'ok'
    })
    expect(render({ agent: 'claude', sessionId: OTHER_SESSION }).limits).toEqual([
      { name: 'Session', usedPercent: 9, windowMinutes: 300, resetsAt: 1_791_678_000 }
    ])
  })

  it('are none for a Claude session whose own beacon carries no limit, whatever the host feed says (an API-key session)', () => {
    beacon(RECORDED.replace(/ h5=\S+/, '').replace(/ d7=\S+/, ''))
    fakes.accounts = hostFeed({
      provider: 'claude',
      session: window(100, 300, 1_791_678_000_000),
      weekly: null,
      updatedAt: 1,
      error: null,
      status: 'ok'
    })
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).limits).toEqual([])
  })

  it('are the host\'s feed for Codex, whose beacon carries no limit', () => {
    fakes.accounts = hostFeed(null, {
      provider: 'codex',
      session: window(100, 300, 1_791_678_000_000),
      weekly: window(40, 10_080, 1_791_997_200_000),
      updatedAt: 1,
      error: null,
      status: 'ok'
    })
    expect(render({ agent: 'codex', sessionId: 'thread-1' }).limits.map((row) => [row.name, row.usedPercent])).toEqual([
      ['Session', 100],
      ['Weekly', 40]
    ])
  })

  it('are none from no beacon and no feed', () => {
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).limits).toEqual([])
  })

  it('are none for an agent the host feed does not cover', () => {
    fakes.accounts = hostFeed({ provider: 'claude', session: window(100, 300, 1_791_678_000_000), weekly: null, updatedAt: 1, error: null, status: 'ok' })
    expect(render({ agent: 'omp', sessionId: 'x' }).limits).toEqual([])
  })

  it('come without a context figure: the banner needs the windows, not the ring', () => {
    beacon(RECORDED.replace(/ used=\d+/, '').replace(/ win=\d+/, '').replace(/ pct=\d+/, ''))
    const read = render({ agent: 'claude', sessionId: RECORDED_SESSION })
    expect(read.context).toBeNull()
    expect(read.limits).toHaveLength(2)
  })
})

describe('the /context table the HUD hands the context sheet', () => {
  const NOW = new Date(2026, 9, 14, 21, 30).getTime()

  it('rides on the context reading the ring is drawn from, stamped with when it was seen', () => {
    fakes.screen = parseTerminalHudObservation(STATUS_LINE)
    fakes.contextReport = { report: TABLE, firstRead: false }
    const read = render({ agent: 'claude', sessionId: RECORDED_SESSION })
    expect(read.context?.usedPercent).toBe(22)
    expect(read.context?.breakdown).toEqual({ report: TABLE, readAt: NOW })
  })

  it('is kept once the screen no longer shows it, and ends with the session', () => {
    fakes.screen = parseTerminalHudObservation(STATUS_LINE)
    fakes.contextReport = { report: TABLE, firstRead: false }
    render({ agent: 'claude', sessionId: RECORDED_SESSION })
    fakes.contextReport = null
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).context?.breakdown?.report).toBe(TABLE)
    // `/clear` starts another session: the old table is not its.
    expect(render({ agent: 'claude', sessionId: OTHER_SESSION }).context?.breakdown).toBeUndefined()
  })

  it('is replaced by a table that differs', () => {
    fakes.screen = parseTerminalHudObservation(STATUS_LINE)
    fakes.contextReport = { report: TABLE, firstRead: false }
    render({ agent: 'claude', sessionId: RECORDED_SESSION })
    fakes.contextReport = { report: OTHER_TABLE, firstRead: false }
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).context?.breakdown?.report).toBe(OTHER_TABLE)
  })

  it('waits for a context figure: with no ring there is no sheet to draw it in', () => {
    fakes.screen = null
    fakes.contextReport = { report: TABLE, firstRead: false }
    expect(render({ agent: 'claude', sessionId: RECORDED_SESSION }).context).toBeNull()
  })

  it('is not drawn into Codex\'s context reading, which has no table to hold', () => {
    fakes.screen = parseTerminalHudObservation([
      '› Ask Codex to do anything',
      '  gpt-5.6-sol xhigh · ~/Project · Context 62% left'
    ])
    fakes.contextReport = null
    const read = render({ agent: 'codex', sessionId: 'thread-1' })
    expect(read.context?.usedPercent).toBe(38)
    expect(read.context?.breakdown).toBeUndefined()
  })
})
