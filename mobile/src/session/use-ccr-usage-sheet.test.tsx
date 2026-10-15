/**
 * The Usage sheet of a Claude tab reads every figure from the session and account the tab runs
 * under (the user, 2026-10-15: plan and weekly figures "MUST come from the account/profile THAT
 * session runs under ... never another signed-in account"). A session copied between profiles is
 * on Anthropic twice, once per account; the tab's own copy is the one asked.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcrEvent, CcrPlanRow } from './ccr-session-api'
import { bindCcrConfigDir, resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { resetCcrUsageForTests, type CcrUsageReading } from './ccr-session-usage'
import { planCards } from './ccr-usage-sheet-model'
import { ccrUsageFallbackFigure, resetCcrUsageSheetForTests, useCcrUsageSheet, type CcrUsageAskDeps, type CcrUsageSheetArgs } from './use-ccr-usage-sheet'

const TAB = 'pane-90bb5855'
const CLAUDE_SESSION = 'e50745d9-0000-4000-8000-000000000001'
const PERSONAL_DIR = '/Users/alwinpaul/.claude'
const WORK_DIR = '/Users/alwinpaul/.claude-work'
const PERSONAL = 'acct-personal'
const WORK = 'acct-work'
const PERSONAL_CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'
const WORK_CSE = 'cse_019B3GJ144LCrvsuFFkN8U6U'

const rows = (session: number, week: number): CcrPlanRow[] => [
  { kind: 'session', percent: session, resetsAt: null, modelName: null },
  { kind: 'weekly_all', percent: week, resetsAt: null, modelName: null }
]
const reading = (accountId: string, sessionId: string | null, planRows: CcrPlanRow[] | null): CcrUsageReading => ({
  sessionId, accountId, epoch: 1, fetchedAt: Date.now(), limits: planRows ? [] : null, planRows, context: null
})

const assistant = (uuid: string): CcrEvent => ({ eventId: uuid, sequenceNum: null, createdAt: null, payload: { type: 'assistant', uuid } }) as unknown as CcrEvent
const result = (uuid: string): CcrEvent => ({ eventId: uuid, sequenceNum: null, createdAt: null, payload: { type: 'result', uuid } }) as unknown as CcrEvent

/** A session that answers the next ask with `answer` (or never, or refuses), recording who was asked. */
function fakeSession() {
  const asked: { accountId: string; sessionId: string; body: unknown }[] = []
  let reply: ((requestId: string) => Record<string, unknown> | null) | null = null
  const make: CcrUsageAskDeps = (accountId, sessionId) => {
    let waiting: { id: string; resolve: (payload: Record<string, unknown> | null) => void } | null = null
    return {
      deps: {
        waitForResponse: (id) => ({ reply: new Promise((resolve) => (waiting = { id, resolve })), cancel: () => waiting?.resolve(null) }),
        post: async (body) => {
          asked.push({ accountId, sessionId, body })
          const w = waiting as { id: string; resolve: (payload: Record<string, unknown> | null) => void } | null
          if (w && reply) {
            w.resolve(reply(w.id))
          }
        },
        newUuid: (() => {
          let n = 0
          return () => `id-${(n += 1)}`
        })(),
        log: () => undefined
      },
      release: () => undefined
    }
  }
  return {
    make,
    asked,
    answer: (used: number, window: number) => {
      reply = (id) => ({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { totalTokens: used, rawMaxTokens: window } } })
    },
    silent: () => {
      reply = () => null
    }
  }
}

let renderer: ReactTestRenderer | null = null
let latest: ReturnType<typeof useCcrUsageSheet> | null = null

function Probe(props: CcrUsageSheetArgs) {
  latest = useCcrUsageSheet(props)
  return null
}

function render(props: Partial<CcrUsageSheetArgs> & Pick<CcrUsageSheetArgs, 'configDir'>, session = fakeSession()) {
  const full: CcrUsageSheetArgs = {
    enabled: true, tabId: TAB, epoch: 1, agentSessionId: CLAUDE_SESSION, events: [], reading: null, fallback: null, needsContext: false,
    askDeps: session.make, refreshPlan: async () => undefined, ...props
  }
  act(() => {
    if (renderer) {
      renderer.update(createElement(Probe, full))
    } else {
      renderer = create(createElement(Probe, full))
    }
  })
  return { session, full }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetCcrCacheForTests()
  resetCcrUsageForTests()
  resetCcrUsageSheetForTests()
  bindCcrConfigDir(PERSONAL_DIR, PERSONAL)
  bindCcrConfigDir(WORK_DIR, WORK)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  latest = null
})

describe('the Usage sheet of a work tab and a personal tab', () => {
  it('shows the work account’s plan on the work tab and the personal account’s on the personal tab', () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    render({ configDir: WORK_DIR, reading: reading(WORK, WORK_CSE, rows(62, 40)) })
    expect(planCards(latest!.sheet!.plan, 0).session[0]).toMatchObject({ figure: '62% used' })
    act(() => renderer?.unmount())
    renderer = null

    resetCcrCacheForTests()
    bindCcrConfigDir(PERSONAL_DIR, PERSONAL)
    bindCcrConfigDir(WORK_DIR, WORK)
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, PERSONAL_DIR)
    render({ configDir: PERSONAL_DIR, reading: reading(PERSONAL, PERSONAL_CSE, rows(28, 11)) })
    expect(planCards(latest!.sheet!.plan, 0).session[0]).toMatchObject({ figure: '28% used' })
  })

  it('never shows another account’s rows: a personal tab handed the work reading shows Loading', () => {
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, PERSONAL_DIR)
    render({ configDir: PERSONAL_DIR, reading: reading(WORK, WORK_CSE, rows(62, 40)) })
    expect(planCards(latest!.sheet!.plan, 0).session[0]).toMatchObject({ figure: 'Loading' })
  })

  it('shows no plan at all while the profile is not known or the match is under the other account', () => {
    // No account of the tab's own: no Usage sheet (the old card opens), so no figure of the
    // other account can show either.
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, PERSONAL_DIR)
    render({ configDir: PERSONAL_DIR, reading: reading(WORK, WORK_CSE, rows(62, 40)) })
    expect(latest!.sheet).toBeNull()
    render({ configDir: null, reading: reading(WORK, WORK_CSE, rows(62, 40)) })
    expect(latest!.sheet).toBeNull()
  })

  it('shows the config dir’s account before the match lands', () => {
    render({ configDir: WORK_DIR, reading: reading(WORK, null, rows(5, 6)) })
    expect(planCards(latest!.sheet!.plan, 0).weekly[0]).toMatchObject({ figure: '6% used' })
  })

  it('asks the tab’s own copy of the session, with its own account, when the sheet opens', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    const { session } = render({ configDir: WORK_DIR })
    session.answer(145_500, 400_000)
    act(() => latest!.onOpen())
    await flush()
    expect(session.asked.map(({ accountId, sessionId }) => [accountId, sessionId])).toEqual([[WORK, WORK_CSE]])
    expect(latest!.sheet!.context.answer).toEqual({ usedTokens: 145_500, windowTokens: 400_000, percent: 36 })
    expect(latest!.live).toEqual({ usedTokens: 145_500, windowTokens: 400_000, percent: 36 })
  })

  it('asks nothing for a tab with no target of its own', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, PERSONAL_DIR)
    const { session } = render({ configDir: PERSONAL_DIR })
    act(() => latest!.onOpen())
    await flush()
    expect(session.asked).toEqual([])
  })
})

describe('the live context', () => {
  it('asks again when a turn ends, so the ring follows the session', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    const session = fakeSession()
    session.answer(100_000, 400_000)
    render({ configDir: WORK_DIR, events: [result('r-1')] }, session)
    expect(session.asked).toHaveLength(0)
    session.answer(145_500, 400_000)
    render({ configDir: WORK_DIR, events: [result('r-1'), result('r-2')], askDeps: session.make }, session)
    await flush()
    expect(session.asked).toHaveLength(1)
    expect(latest!.live?.usedTokens).toBe(145_500)
  })

  it('lets an answer go when the next turn ends, and shows it with its time in the sheet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 17, 2))
    try {
      setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
      const session = fakeSession()
      session.answer(145_500, 400_000)
      render({ configDir: WORK_DIR, events: [result('r-1')] }, session)
      act(() => latest!.onOpen())
      await flush()
      session.silent()
      render({ configDir: WORK_DIR, events: [result('r-1'), result('r-2')], askDeps: session.make }, session)
      await flush()
      expect(latest!.live).toBeNull()
      expect(latest!.sheet!.context.figure).toMatchObject({ usedTokens: 145_500, updatedAt: new Date(2026, 9, 15, 17, 2).getTime() })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the plan rows shown when a refresh fails, and says it could not refresh', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    render({ configDir: WORK_DIR, reading: reading(WORK, WORK_CSE, rows(62, 40)) })
    render({ configDir: WORK_DIR, reading: null, refreshPlan: () => Promise.reject(new Error('usage: 503')) })
    act(() => latest!.sheet!.onRefresh())
    await flush()
    const cards = planCards(latest!.sheet!.plan, 0)
    expect(cards.session[0]).toMatchObject({ figure: '62% used' })
    expect(cards.refreshError).toBe('Couldn’t refresh usage')
  })
})

describe('what the sheet shows before the session answers', () => {
  it('is the ring’s own figure, else the session row’s statement, else nothing', () => {
    expect(ccrUsageFallbackFigure({ usedPercent: 32, usedLabel: '128k', windowLabel: '400k' }, null)).toEqual({ usedTokens: null, windowTokens: null, usedLabel: '128k', windowLabel: '400k', percent: 32 })
    expect(ccrUsageFallbackFigure({ usedPercent: 40, usedLabel: null, windowLabel: null }, null)).toMatchObject({ percent: 40, usedLabel: null })
    expect(ccrUsageFallbackFigure(null, reading(WORK, WORK_CSE, null))).toBeNull()
    expect(ccrUsageFallbackFigure(null, { ...reading(WORK, WORK_CSE, null), context: { usedTokens: 32_800, windowTokens: null } })).toEqual({ usedTokens: 32_800, windowTokens: null, percent: null })
  })
})

describe('review findings, 2026-10-15', () => {
  it('leaves a tab with no target and no known account on the old context card', () => {
    render({ configDir: null })
    expect(latest!.sheet).toBeNull()
  })

  it('lets the answer go as soon as the next turn starts writing, so the beacon leads mid-turn', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    const session = fakeSession()
    session.answer(145_500, 400_000)
    render({ configDir: WORK_DIR, events: [result('r-1')] }, session)
    act(() => latest!.onOpen())
    await flush()
    expect(latest!.live).not.toBeNull()
    render({ configDir: WORK_DIR, events: [result('r-1'), assistant('a-2')] }, session)
    expect(latest!.live).toBeNull()
  })

  it('an answer that lands after the turn moved still stands for the turn it was read in', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    let deliver: ((payload: Record<string, unknown> | null) => void) | null = null
    let requestId = ''
    const slow: CcrUsageAskDeps = () => ({
      deps: {
        waitForResponse: (id) => {
          requestId = id
          return { reply: new Promise((resolve) => (deliver = resolve)), cancel: () => undefined }
        },
        post: async () => undefined,
        newUuid: (() => { let n = 0; return () => `slow-${(n += 1)}` })(),
        log: () => undefined
      },
      release: () => undefined
    })
    render({ configDir: WORK_DIR, events: [result('r-1')], askDeps: slow })
    act(() => latest!.onOpen())
    await flush()
    // The turn ends while the ask is still out; its reply lands after.
    render({ configDir: WORK_DIR, events: [result('r-1'), result('r-2')], askDeps: slow })
    await flush()
    await act(async () => deliver!({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { totalTokens: 150_000, rawMaxTokens: 400_000 } } }))
    await flush()
    expect(latest!.live?.usedTokens).toBe(150_000)
  })

  it('does not ask when the events only went away and came back (a relink), only at a turn end', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    const session = fakeSession()
    session.answer(1, 400_000)
    render({ configDir: WORK_DIR, events: [result('r-1')] }, session)
    render({ configDir: WORK_DIR, events: [] }, session)
    render({ configDir: WORK_DIR, events: [result('r-1')] }, session)
    await flush()
    expect(session.asked).toHaveLength(0)
  })

  it('runs one plan re-read at a time however often refresh is tapped', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    let calls = 0
    let finish: () => void = () => undefined
    render({ configDir: WORK_DIR, refreshPlan: () => { calls += 1; return new Promise<void>((resolve) => (finish = resolve)) } })
    act(() => { latest!.sheet!.onRefresh(); latest!.sheet!.onRefresh(); latest!.sheet!.onRefresh() })
    expect(calls).toBe(1)
    await act(async () => finish())
  })
})
