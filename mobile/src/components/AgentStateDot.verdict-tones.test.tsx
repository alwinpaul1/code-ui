import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Animated: {
      View: 'View',
      Value: class {
        interpolate(): string {
          return '0deg'
        }
        setValue(): void {}
      },
      loop: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({})
    },
    Easing: { linear: 'linear' },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children),
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  CircleCheck: 'CircleCheck',
  MessageCircleQuestionMark: 'MessageCircleQuestionMark'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

import { contrastRatio } from '../test/contrast'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { tabPillBackground, tabPillDotSurface } from '../session/tab-pill-surface'
import { AgentStateDot } from './AgentStateDot'

// Claude Code 2.1.x / Orca 1.4.220 host: the row verdicts a done turn can carry.
describe('the agent dot for a turn that did not simply finish', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  type Surface = { onLightSurface?: boolean; onDarkSurface?: boolean }

  /** The colour the dot is drawn in: the icon's stroke (done, question, monitoring), the spinner's
   *  arc (working), or the dot's fill (every verdict). */
  function dotColor(
    state: Parameters<typeof AgentStateDot>[0]['state'],
    scheme: 'light' | 'dark',
    surface: Surface = {}
  ): unknown {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <AgentStateDot state={state} {...surface} />
        </ThemeProvider>
      )
    })
    for (const icon of ['Activity', 'CircleCheck', 'MessageCircleQuestionMark']) {
      const [drawn] = renderer!.root.findAllByType(icon as never)
      if (drawn) {
        return drawn.props.color
      }
    }
    for (const view of renderer!.root.findAllByType('View' as never)) {
      const style = view.props.style
      if (!Array.isArray(style)) {
        continue
      }
      for (const entry of style) {
        if (entry && typeof entry === 'object' && 'borderColor' in entry) {
          return (entry as { borderColor: unknown }).borderColor
        }
        if (entry && typeof entry === 'object' && 'backgroundColor' in entry) {
          return (entry as { backgroundColor: unknown }).backgroundColor
        }
      }
    }
    return undefined
  }

  it.each(['light', 'dark'] as const)(
    "draws a user's Stop muted and an unproven end amber in the %s theme's own tones",
    (scheme) => {
      const palette = scheme === 'dark' ? darkColors : lightColors
      expect(dotColor('interrupted', scheme)).toBe(palette.textMuted)
      expect(dotColor('unconfirmed', scheme)).toBe(palette.warning)
    }
  )

  it('draws a fault red in either theme, as the desktop does', () => {
    expect(dotColor('failed', 'light')).toBe('#ef4444')
    expect(dotColor('failed', 'dark')).toBe('#ef4444')
  })

  it('uses darker tones when the dot sits on a light pill', () => {
    expect(dotColor('interrupted', 'dark', { onLightSurface: true })).toBe('#57534e')
    expect(dotColor('unconfirmed', 'dark', { onLightSurface: true })).toBe('#b45309')
    // The desktop's red-500 was 3.04:1 on the light scheme's pressed pill: past the floor, and
    // still the faintest mark there. Red-600 on a light pill, as the other hues step down.
    expect(dotColor('failed', 'light', { onLightSurface: true })).toBe('#dc2626')
    expect(dotColor('blocked', 'light', { onLightSurface: true })).toBe('#dc2626')
  })

  // Every fill the tab pill has (tabPillBackground): the selected pill is the theme's text colour,
  // light in the dark scheme and near-black in the light one; an unselected pill is the panel, and
  // bgRaised while a finger is on it. Each dot is drawn with the flags the header passes for that
  // pill (tabPillDotSurface; tab-pill-draws-turn-verdict.test.ts pins the header to both) and must
  // clear 3:1 there, the floor WCAG 1.4.11 sets for a graphic. Until 2026-10-04 the light scheme's
  // unselected pill drew the desktop tones: working 1.84:1, done 2.43:1, question 2.68:1, and
  // amber 2.94:1 while pressed.
  const PILL_DOTS = [
    'working',
    'monitoring',
    'done',
    'waiting',
    'failed',
    'blocked',
    'interrupted',
    'unconfirmed'
  ] as const

  it.each([
    ['light', 'selected', lightColors, true, false],
    ['light', 'unselected', lightColors, false, false],
    ['light', 'pressed unselected', lightColors, false, true],
    ['dark', 'selected', darkColors, true, false],
    ['dark', 'unselected', darkColors, false, false],
    ['dark', 'pressed unselected', darkColors, false, true]
  ] as const)(
    "keeps every dot readable on the %s scheme's %s pill",
    (scheme, _pill, palette, active, pressed) => {
      const fill = tabPillBackground(palette, active, pressed)
      const surface = tabPillDotSurface(active, scheme === 'dark')
      const faint: string[] = []
      for (const state of PILL_DOTS) {
        const tone = String(dotColor(state, scheme, surface))
        const ratio = contrastRatio(tone, fill)
        if (!(ratio >= 3)) {
          faint.push(`${state} ${tone} on ${fill}: ${ratio.toFixed(2)}:1`)
        }
      }
      expect(faint).toEqual([])
    }
  )
})
