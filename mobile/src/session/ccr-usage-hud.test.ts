import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyCcrUsageToHud } from './ccr-usage-hud'
import type { CcrUsageReading } from './ccr-session-usage'
import { contextRingColor, sessionHeaderContextReading } from './session-header-display'
import { darkColors, lightColors } from '../theme/tokens'

// A work tab and a personal tab, each with the ring and rows of its own account and session. The
// host's feed (Orca's login) says 12% here: it must never reach a tab matched to an account.
const hostLimits = [{ name: 'Session', usedPercent: 12, windowMinutes: 300, resetsAt: 9_999_999_999 }]

const reading = (overrides: Partial<CcrUsageReading> = {}): CcrUsageReading => ({
  sessionId: 'cse_work',
  accountId: 'work',
  epoch: 1,
  fetchedAt: 0,
  limits: [
    { name: 'Session', usedPercent: 88, windowMinutes: 300, resetsAt: 2_000_000_000 },
    { name: 'Weekly', usedPercent: 40, windowMinutes: 10_080, resetsAt: 2_000_100_000 }
  ],
  context: { usedTokens: 80_003, windowTokens: 1_000_000 },
  ...overrides
})

const nothingToday = { context: null, limits: [], usedTokens: null }
const hostToday = { context: null, limits: hostLimits, usedTokens: null }
const beaconContext = {
  usedPercent: 54,
  usedLabel: '537.2k',
  windowLabel: '1M',
  limits: [{ name: 'Session', usedPercent: 21, windowMinutes: null, resetsAt: 2_000_000_000 }]
}

describe('the ring from Anthropic’s session', () => {
  it('draws a ring when the session stated its window', () => {
    const merged = applyCcrUsageToHud(nothingToday, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.context).toMatchObject({ usedPercent: 8, usedLabel: '80.0k', windowLabel: '1.0M' })
    expect(sessionHeaderContextReading(merged.context, merged.usedTokens)).toEqual({ kind: 'ring', percent: 8, step: 'calm' })
  })

  it('shows the tokens alone when the window is unknown: no percentage, no ring', () => {
    const merged = applyCcrUsageToHud(nothingToday, { reading: reading({ context: { usedTokens: 493_000, windowTokens: null } }), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.context).toBeNull()
    expect(merged.usedTokens).toBe(493_000)
    expect(sessionHeaderContextReading(merged.context, merged.usedTokens)).toEqual({ kind: 'tokens', usedLabel: '493k' })
  })

  it('never overrides what this session’s own terminal states', () => {
    const merged = applyCcrUsageToHud({ ...nothingToday, context: beaconContext, usedTokens: 7 }, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: true })
    expect(merged.context).toBe(beaconContext)
    expect(merged.usedTokens).toBe(7)
  })

  it('draws nothing when no reading is fresh, and invents no denominator', () => {
    const merged = applyCcrUsageToHud(nothingToday, { reading: null, matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged).toEqual({ context: null, limits: [], usedTokens: null })
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('steps its colour from the %s palette', (_scheme, palette) => {
    const near = applyCcrUsageToHud(nothingToday, { reading: reading({ context: { usedTokens: 920_000, windowTokens: 1_000_000 } }), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    const ring = sessionHeaderContextReading(near.context, near.usedTokens)
    expect(ring).toMatchObject({ kind: 'ring', percent: 92, step: 'danger' })
    expect(contextRingColor('danger', palette)).toBe(palette.danger)
    expect(contextRingColor('calm', palette)).toBe(palette.info)
  })
})

describe('the usage rows of a tab matched to an account', () => {
  it('are the matched account’s, not the host’s feed', () => {
    const merged = applyCcrUsageToHud(hostToday, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.limits.map((row) => row.usedPercent)).toEqual([88, 40])
  })

  it('are the other account’s own on the other tab, side by side', () => {
    const work = applyCcrUsageToHud(hostToday, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    const personal = applyCcrUsageToHud(hostToday, {
      reading: reading({ sessionId: 'cse_personal', accountId: 'personal', limits: [{ name: 'Session', usedPercent: 3, windowMinutes: 300, resetsAt: 2_000_000_000 }], context: { usedTokens: 4_005, windowTokens: null } }),
      matchedAccount: true, hostFeedAllowed: true,
      beaconDecidesLimits: false
    })
    expect(work.limits.map((row) => row.usedPercent)).toEqual([88, 40])
    expect(personal.limits.map((row) => row.usedPercent)).toEqual([3])
    expect(personal.usedTokens).toBe(4_005)
    expect(work.usedTokens).toBeNull()
  })

  it('are none, not the host’s, when the account’s usage could not be read', () => {
    const merged = applyCcrUsageToHud(hostToday, { reading: reading({ limits: null }), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.limits).toEqual([])
  })

  it('are none when signed out of the matched account (no fresh reading)', () => {
    expect(applyCcrUsageToHud(hostToday, { reading: null, matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false }).limits).toEqual([])
  })

  it('replace the host’s rows on the context sheet too, or drop them when there are none', () => {
    const hostContext = { usedPercent: 30, usedLabel: '300k', windowLabel: '1M', limits: hostLimits }
    const withRows = applyCcrUsageToHud({ context: hostContext, limits: hostLimits, usedTokens: null }, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(withRows.context?.limits?.map((row) => row.usedPercent)).toEqual([88, 40])
    const without = applyCcrUsageToHud({ context: hostContext, limits: hostLimits, usedTokens: null }, { reading: reading({ limits: null }), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(without.context?.limits).toBeUndefined()
  })

  it('stay the live Claude beacon’s when one is believed', () => {
    const merged = applyCcrUsageToHud({ context: beaconContext, limits: beaconContext.limits.map((row) => ({ ...row })), usedTokens: null }, { reading: reading(), matchedAccount: true, hostFeedAllowed: true, beaconDecidesLimits: true })
    expect(merged.limits.map((row) => row.usedPercent)).toEqual([21])
    expect(merged.context?.limits?.map((row) => row.usedPercent)).toEqual([21])
  })

  // The user: the work tab shows the work account's numbers only. No account known for the tab and
  // several signed in (or the count not read yet): the host's login could be the other one.
  it.each([
    ['several accounts are signed in, or the count is not read yet', false]
  ])('are none for a tab with no account known when %s', (_name, hostFeedAllowed) => {
    const hostContext = { usedPercent: 30, usedLabel: '300k', windowLabel: '1M', limits: hostLimits }
    const merged = applyCcrUsageToHud({ context: hostContext, limits: hostLimits, usedTokens: null }, { reading: null, matchedAccount: false, hostFeedAllowed, beaconDecidesLimits: false })
    expect(merged.limits).toEqual([])
    expect(merged.context?.limits).toBeUndefined()
    expect(merged.context?.usedPercent).toBe(30)
  })

  it('stay the host’s feed for a tab with no account known when at most one is signed in, as before', () => {
    const merged = applyCcrUsageToHud(hostToday, { reading: null, matchedAccount: false, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.limits).toEqual(hostLimits)
  })

  it('stay the host’s feed for a tab matched to no account, as before', () => {
    const merged = applyCcrUsageToHud(hostToday, { reading: null, matchedAccount: false, hostFeedAllowed: true, beaconDecidesLimits: false })
    expect(merged.limits).toEqual(hostLimits)
  })
})

// 2026-10-15: the phone's ring read 128k of 400k from the status line while the Claude app showed
// 145.5k, which it had asked the session for (get_context_usage). The session's own answer for the
// current turn is the ring, over the beacon, the badge and the row's statement; the usage rows are
// untouched by it.
describe('the ring from the session’s live answer', () => {
  it('shows the answer the session gave, not the status line a turn behind', () => {
    const today = { context: { usedPercent: 32, usedLabel: '128k', windowLabel: '400k', limits: hostLimits }, limits: hostLimits, usedTokens: null }
    const merged = applyCcrUsageToHud(today, { reading: null, matchedAccount: false, hostFeedAllowed: true, beaconDecidesLimits: true, live: { usedTokens: 145_500, windowTokens: 400_000, percent: 36 } })
    expect(merged.context).toMatchObject({ usedPercent: 36, usedLabel: '145.5k', windowLabel: '400k', limits: hostLimits })
    expect(merged.limits).toEqual(hostLimits)
  })

  it('draws a ring from the answer when nothing else states one, at 0% and at 100%', () => {
    for (const percent of [0, 100]) {
      const merged = applyCcrUsageToHud(nothingToday, { reading: null, matchedAccount: true, hostFeedAllowed: false, beaconDecidesLimits: false, live: { usedTokens: percent * 4000, windowTokens: 400_000, percent } })
      expect(merged.context).toMatchObject({ usedPercent: percent, windowLabel: '400k' })
    }
  })

  it('keeps today’s ring when there is no live answer', () => {
    const merged = applyCcrUsageToHud({ context: beaconContext, limits: [], usedTokens: null }, { reading: null, matchedAccount: false, hostFeedAllowed: true, beaconDecidesLimits: true, live: null })
    expect(merged.context).toMatchObject({ usedPercent: 54, usedLabel: '537.2k' })
  })
})

// A structural pin: the ring and rows are read in the controller, where no behavioural test reaches
// without the whole session screen. The window, the rows and the token count must all pass through
// the merge, so none of them keeps reading the host's feed or the raw HUD.
describe('the controller', () => {
  it('draws the ring, the rows and the tokens from the merge, not from the raw HUD', () => {
    const code = readFileSync(join(__dirname, 'use-mobile-native-chat-controller.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).toContain('nativeChatContextWindow: ccrHud.context, nativeChatRateLimits: ccrHud.limits, nativeChatContextUsedTokens: ccrHud.usedTokens,')
    expect(code).not.toContain('nativeChatContextWindow: liveHud.context')
    expect(code).toContain('needsContext: liveHud.context === null')
    expect(code).toContain('hostFeedAllowed: ccrUsage.hostFeedAllowed')
    expect(code).toMatch(/useCcrSessionUsage\(\{[^}]*configDir: claudeConfigDirFromTranscriptPath/)
    expect(code).toContain('applyCcrUsageToHud(')
  })
})
