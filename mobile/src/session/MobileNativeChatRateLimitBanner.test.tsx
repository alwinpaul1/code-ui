import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's rate-limit banner (com.anthropic.claude 1.261009.20, `pj8.a` and `bb8` case 4): a
// surface of radius 16 in `pl7.s`, 12 dp of padding all round, a row spread across the width and
// centred. The words on the left fill the row: the title at 13/550 (`jn7.I`), then 2 dp, the
// subtitle at 11/400 (`jn7.K`) in `pl7.P`. On the right, 8 dp apart: a small secondary "View usage"
// button (`i820.c` with `lf4` and `bf4`: 36 dp tall, 15/550, the 15% ink fill `pl7.x`) and, when the
// notice can be closed, the 20 dp close glyph in `pl7.P` in a 40 dp target.
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  X: (props: Record<string, unknown>) => createElement('X', props)
}))
// The clock the banner is read against is the test's own (fake timers); the real hook also listens to
// AppState.
vi.mock('../hooks/use-now', () => ({ useNow: () => Date.now() }))
// The real drawer keeps its content mounted only while it is open.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))

import { ThemeProvider } from '../theme/theme-context'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { applyCcrUsageToHud } from './ccr-usage-hud'
import { hudRateLimitWindows, type RateLimitNotice } from './hud-rate-limit-notice'
import { parseCcrEvent } from './ccr-session-api'
import { deriveCcrLiveState } from './ccr-live-state'
import { event } from './fixtures/ccr-session-api-2026-10-14'
import { RESETS_AT_FIVE_HOUR, allowedFiveHour, rejectedFiveHour } from './fixtures/ccr-rate-limit-events-2026-10-15'
import {
  MobileNativeChatRateLimitBanner,
  RateLimitBannerView,
  resetDismissedRateLimitNotices
} from './MobileNativeChatRateLimitBanner'
import type { MobileSessionController } from './use-mobile-session-controller'

// Claude Code 2.1.296's recorded beacon (fixtures/claude-busy-lead-tasks-2.1.296/beacon-payloads.txt):
// the 5-hour window at 20% (resets 1791678000) and the weekly at 73% (resets 1791997200). Where a test
// needs another figure, only those two numbers are replaced.
const RECORDED = readFileSync(
  join(import.meta.dirname, 'fixtures/claude-busy-lead-tasks-2.1.296/beacon-payloads.txt'),
  'utf8'
).split('\n')[0]!
const SESSION_RESETS = 1_791_678_000
const windowsFor = (h5: string, d7: string) =>
  hudRateLimitWindows(
    parseAgentHudBeaconPayload(RECORDED.replace('h5=20:1791678000', `h5=${h5}`).replace('d7=73:1791997200', `d7=${d7}`), 0),
    null
  )
const RECORDING_TIME = (SESSION_RESETS - 3600) * 1000

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(RECORDING_TIME)
  resetDismissedRateLimitNotices()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

type Scheme = 'light' | 'dark'
const palette = (scheme: Scheme) => (scheme === 'light' ? lightColors : darkColors)
function flat(style: unknown): Record<string, unknown> {
  const list = [typeof style === 'function' ? style({ pressed: false }) : style].flat(Infinity)
  return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'))
}
const host = (id: string): ReactTestInstance =>
  renderer!.root.find((node) => node.props.testID === id && typeof node.type === 'string')
const hasHost = (id: string): boolean =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string').length > 0
const words = (root: ReactTestInstance = renderer!.root): string[] =>
  root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
const textNode = (text: string): ReactTestInstance =>
  renderer!.root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === text)

const APPROACHING: RateLimitNotice = {
  kind: 'approaching',
  title: 'Approaching limit',
  subtitle: 'Resets Friday at 9:05 am',
  dismissible: true,
  key: 'approaching:weekly:1'
}
const REACHED: RateLimitNotice = { ...APPROACHING, kind: 'reached', title: 'Limit reached', dismissible: true, key: 'reached:session:1' }
const CREDITS: RateLimitNotice = {
  kind: 'credits',
  title: 'Now using usage credits',
  subtitle: null,
  dismissible: true,
  key: 'credits'
}

describe.each(['light', 'dark'] as const)('the rate-limit banner in %s mode', (scheme) => {
  const colors = palette(scheme)
  const show = (notice: RateLimitNotice, over: { onViewUsage?: () => void; onDismiss?: () => void } = {}) =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <RateLimitBannerView
            notice={notice}
            onViewUsage={'onViewUsage' in over ? over.onViewUsage : () => {}}
            onDismiss={'onDismiss' in over ? over.onDismiss : () => {}}
          />
        </ThemeProvider>
      )
    })

  it('is a 16 dp surface in the code header\'s fill (pl7.s) with 12 dp of padding, its words left and its buttons right', () => {
    show(APPROACHING)
    expect(flat(host('rate-limit-banner').props.style)).toMatchObject({
      borderRadius: 16,
      padding: 12,
      backgroundColor: colors.codeBlockHeader,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    })
  })

  it('says the title at 13/550 in the text colour and the subtitle at 11/400 in pl7.P, 2 dp under it', () => {
    show(APPROACHING)
    expect(flat(textNode('Approaching limit').props.style)).toMatchObject({
      fontSize: 13,
      fontFamily: 'InstrumentSans_500Medium',
      color: colors.text
    })
    expect(flat(textNode('Resets Friday at 9:05 am').props.style)).toMatchObject({
      fontSize: 11,
      lineHeight: 16.5,
      fontFamily: 'InstrumentSans_400Regular',
      color: colors.composerIcon
    })
    expect(flat(host('rate-limit-banner-words').props.style)).toMatchObject({ flex: 1, gap: 2 })
  })

  it('draws "View usage" as a 36 dp secondary button, 15/550 over the 15% ink fill', () => {
    show(APPROACHING)
    const button = host('rate-limit-view-usage')
    expect(flat(button.props.style)).toMatchObject({
      height: 36,
      backgroundColor: colors.composerBorder,
      alignItems: 'center',
      justifyContent: 'center'
    })
    expect(flat(textNode('View usage').props.style)).toMatchObject({
      fontSize: 15,
      fontFamily: 'InstrumentSans_500Medium',
      color: colors.text
    })
    expect(button.props.accessibilityRole).toBe('button')
    // 36 dp drawn, 40 dp to touch (`bf4.d()`).
    expect(button.props.hitSlop).toEqual({ top: 2, bottom: 2, left: 0, right: 0 })
  })

  it('draws the close glyph at 20 dp in pl7.P, named "Dismiss", in a 40 dp target', () => {
    show(APPROACHING)
    const close = host('rate-limit-dismiss')
    expect(close.props.accessibilityLabel).toBe('Dismiss')
    expect(flat(close.props.style)).toMatchObject({ width: 40, height: 40 })
    expect(renderer!.root.find((node) => (node.type as unknown) === 'X').props).toMatchObject({
      size: 20,
      color: colors.composerIcon
    })
  })

  it('draws a limit reached with "View usage" and a close, as the user asked of the Claude app\'s card', () => {
    show(REACHED)
    expect(words()).toEqual(['Limit reached', 'Resets Friday at 9:05 am', 'View usage'])
    expect(hasHost('rate-limit-dismiss')).toBe(true)
  })

  it('draws "Now using usage credits" with no subtitle and no "View usage", but a close', () => {
    show(CREDITS, { onViewUsage: undefined })
    expect(words()).toEqual(['Now using usage credits'])
    expect(hasHost('rate-limit-view-usage')).toBe(false)
    expect(hasHost('rate-limit-dismiss')).toBe(true)
  })

  it('says "Try again later" when it was given no reset to name', () => {
    show({ ...REACHED, subtitle: 'Try again later' })
    expect(words()).toContain('Try again later')
  })

  it('passes a tap on each button to its owner', () => {
    const onViewUsage = vi.fn()
    const onDismiss = vi.fn()
    show(APPROACHING, { onViewUsage, onDismiss })
    act(() => host('rate-limit-view-usage').props.onPress())
    act(() => host('rate-limit-dismiss').props.onPress())
    expect([onViewUsage.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
  })

  it('is announced when it appears, as one sentence', () => {
    show(APPROACHING)
    const banner = host('rate-limit-banner-words')
    expect(banner.props.accessibilityLabel).toBe('Approaching limit. Resets Friday at 9:05 am')
    expect(host('rate-limit-banner').props.accessibilityLiveRegion).toBe('polite')
  })
})

describe('the connected banner', () => {
  const controllerFor = (windows: ReturnType<typeof windowsFor>, agent = 'claude'): MobileSessionController =>
    ({ nativeChatController: { nativeChatRateLimits: windows, nativeChatAgent: agent } }) as unknown as MobileSessionController
  const mount = (controller: MobileSessionController, scheme: Scheme = 'light') =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatRateLimitBanner controller={controller} />
        </ThemeProvider>
      )
    })

  it('draws nothing from the recorded payload as it stands: the weekly 73% is under the 75% tier', () => {
    mount(controllerFor(windowsFor('20:1791678000', '73:1791997200')))
    expect(renderer!.toJSON()).toBeNull()
  })

  it('draws "Approaching limit" at 76% of the week, closable', () => {
    mount(controllerFor(windowsFor('20:1791678000', '76:1791997200')))
    expect(words()[0]).toBe('Approaching limit')
    expect(hasHost('rate-limit-dismiss')).toBe(true)
  })

  it('draws "Limit reached" at 100% with a close, and a close puts it away', () => {
    mount(controllerFor(windowsFor('100:1791678000', '73:1791997200')))
    expect(words()[0]).toBe('Limit reached')
    act(() => host('rate-limit-dismiss').props.onPress())
    expect(renderer!.toJSON()).toBeNull()
  })

  it('draws nothing from a controller that states no windows', () => {
    mount(controllerFor([]))
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount({ nativeChatController: {} } as unknown as MobileSessionController)
    expect(renderer!.toJSON()).toBeNull()
  })

  it('opens the usage sheet from "View usage", with the windows the notice was read from', () => {
    mount(controllerFor(windowsFor('100:1791678000', '73:1791997200')))
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'BottomDrawer')).toHaveLength(0)
    act(() => host('rate-limit-view-usage').props.onPress())
    const drawer = renderer!.root.find((node) => (node.type as unknown) === 'BottomDrawer')
    expect(words(drawer)).toEqual(expect.arrayContaining(['Usage', 'Session', 'Weekly']))
    expect(words(drawer).some((text) => text.startsWith('100% · resets in 1h'))).toBe(true)
    expect(words(drawer).some((text) => text.startsWith('73% · resets in'))).toBe(true)
  })

  it('does not open the usage sheet by itself when a notice comes back after the one that opened it went', () => {
    const update = (controller: MobileSessionController) =>
      act(() =>
        renderer!.update(
          <ThemeProvider initialPreference="light">
            <MobileNativeChatRateLimitBanner controller={controller} />
          </ThemeProvider>
        )
      )
    const full = controllerFor(windowsFor('100:1791678000', '73:1791997200'))
    mount(full)
    act(() => host('rate-limit-view-usage').props.onPress())
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'BottomDrawer')).toHaveLength(1)
    // The window resets (or the beacon dies): no notice, and the sheet that listed it goes with it.
    update(controllerFor([]))
    expect(renderer!.toJSON()).toBeNull()
    // The limit is reached again: the banner is back and the sheet is shut, as the user left it.
    update(full)
    expect(words()[0]).toBe('Limit reached')
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'BottomDrawer')).toHaveLength(0)
  })

  it('stays closed once closed, across a remount, until the limit is a new one', () => {
    const near = controllerFor(windowsFor('20:1791678000', '76:1791997200'))
    mount(near)
    act(() => host('rate-limit-dismiss').props.onPress())
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount(near)
    expect(renderer!.toJSON()).toBeNull()
    // The same window at its next reset is another notice.
    act(() => renderer?.unmount())
    vi.setSystemTime((1_792_602_000 - 4 * 86_400) * 1000)
    mount(controllerFor(windowsFor('20:1792282000', '76:1792602000')))
    expect(words()[0]).toBe('Approaching limit')
  })

  it('a closed limit reached stays closed for that reset, and a new reset brings it back', () => {
    mount(controllerFor(windowsFor('100:1791678000', '73:1791997200')))
    act(() => host('rate-limit-dismiss').props.onPress())
    expect(renderer!.toJSON()).toBeNull()
    mount(controllerFor(windowsFor('100:1791696000', '73:1791997200')))
    expect(words()[0]).toBe('Limit reached')
  })

  // Anthropic's own `rate_limit_event` on a matched Claude tab is the server's call and decides over
  // the thresholds (ccr-rate-limit-notice.ts), as the Claude app draws it.
  const rateLimitOf = (payload: Record<string, unknown>) =>
    deriveCcrLiveState([parseCcrEvent(event(payload))!], { liveFrom: 0, connectionStatus: 'connected' }).rateLimit
  const withAnthropic = (windows: ReturnType<typeof windowsFor>, payload: Record<string, unknown>): MobileSessionController =>
    ({
      nativeChatController: { nativeChatRateLimits: windows, nativeChatAgent: 'claude', nativeChatAnthropicLive: { rateLimit: rateLimitOf(payload) } }
    }) as unknown as MobileSessionController

  it('says "Limit reached" when Anthropic rejects the session, though the beacon\'s windows are under every tier', () => {
    vi.setSystemTime((RESETS_AT_FIVE_HOUR - 3600) * 1000)
    mount(withAnthropic(windowsFor('20:1791678000', '73:1791997200'), rejectedFiveHour('r1')))
    expect(words()[0]).toBe('Limit reached')
  })

  it('draws nothing when Anthropic says the account is clear, though a stale beacon window reads 100%', () => {
    mount(withAnthropic(windowsFor('100:1791678000', '73:1791997200'), allowedFiveHour('r1')))
    expect(renderer!.toJSON()).toBeNull()
  })

  it('falls back to the thresholds when Anthropic\'s event has reset', () => {
    vi.setSystemTime((RESETS_AT_FIVE_HOUR + 60) * 1000)
    mount(withAnthropic(windowsFor('100:1792040000', '73:1792447200'), rejectedFiveHour('r1')))
    expect(words()[0]).toBe('Limit reached')
  })

  it.each(['light', 'dark'] as const)('draws in the %s scheme\'s own fill', (scheme) => {
    mount(controllerFor(windowsFor('100:1791678000', '73:1791997200')), scheme)
    expect(flat(host('rate-limit-banner').props.style).backgroundColor).toBe(palette(scheme).codeBlockHeader)
  })

  it('reads Codex\'s windows the same way, from the host feed rows it is handed', () => {
    mount(
      controllerFor(
        [{ name: 'Session', usedPercent: 100, windowMinutes: 300, resetsAt: SESSION_RESETS }],
        'codex'
      )
    )
    expect(words()[0]).toBe('Limit reached')
  })

  it('draws nothing for an agent with no rule of its own, however full', () => {
    mount(controllerFor([{ name: 'Session', usedPercent: 90, windowMinutes: 300, resetsAt: SESSION_RESETS }], 'omp'))
    expect(renderer!.toJSON()).toBeNull()
  })
})

// Two Anthropic accounts signed in, each tab on its own. The banner reads what the tab's matched
// account says (ccr-usage-hud.ts), never the host feed, which is whichever login Orca holds.
describe('the banner of a tab matched to an Anthropic account', () => {
  const FULL = [{ name: 'Session', usedPercent: 100, windowMinutes: 300, resetsAt: SESSION_RESETS }]
  const hostFeed = { context: null, limits: FULL, usedTokens: null }
  const accountReading = (limits: typeof FULL | null, accountId: string) => ({
    sessionId: `cse_${accountId}`,
    accountId,
    epoch: 1,
    fetchedAt: 0,
    limits: limits === null ? null : limits.map((row) => ({ ...row, name: 'Session' as const })),
    context: null
  })
  const bannerOf = (args: { reading: ReturnType<typeof accountReading> | null; matchedAccount: boolean; hostFeedAllowed: boolean }) => {
    const merged = applyCcrUsageToHud(hostFeed, { ...args, beaconDecidesLimits: false })
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatRateLimitBanner
            controller={{ nativeChatController: { nativeChatRateLimits: merged.limits, nativeChatAgent: 'claude' } } as unknown as MobileSessionController}
          />
        </ThemeProvider>
      )
    })
  }

  it('never shows the personal account\u2019s full limit on a work tab that is at 20%', () => {
    bannerOf({ reading: accountReading([{ ...FULL[0]!, usedPercent: 20 }], 'work'), matchedAccount: true, hostFeedAllowed: true })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('shows its own account\u2019s full limit on the tab that is at 100%', () => {
    bannerOf({ reading: accountReading(FULL, 'personal'), matchedAccount: true, hostFeedAllowed: true })
    expect(words()[0]).toBe('Limit reached')
  })

  it('draws nothing, not the host feed\u2019s limit, when the matched account\u2019s usage could not be read', () => {
    bannerOf({ reading: accountReading(null, 'work'), matchedAccount: true, hostFeedAllowed: true })
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    bannerOf({ reading: null, matchedAccount: true, hostFeedAllowed: true })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('draws nothing for an account with no plan window at all', () => {
    bannerOf({ reading: accountReading([], 'api-key'), matchedAccount: true, hostFeedAllowed: true })
    expect(renderer!.toJSON()).toBeNull()
  })
})
