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
import { AgentStateDot } from './AgentStateDot'

// Claude Code 2.1.x / Orca 1.4.220 host: the row verdicts a done turn can carry.
describe('the agent dot for a turn that did not simply finish', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  type Surface = { onLightSurface?: boolean; onDarkSurface?: boolean }

  function dotColor(
    state: Parameters<typeof AgentStateDot>[0]['state'],
    scheme: 'light' | 'dark',
    surface: Surface = {}
  ): unknown {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <AgentStateDot state={state} {...surface} />
        </ThemeProvider>
      )
    })
    for (const view of renderer!.root.findAllByType('View' as never)) {
      const style = view.props.style
      if (!Array.isArray(style)) {
        continue
      }
      const tone = style.find((entry) => entry && typeof entry === 'object' && 'backgroundColor' in entry)
      if (tone) {
        return (tone as { backgroundColor: unknown }).backgroundColor
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

  it('uses darker tones when the dot sits on the light selected pill', () => {
    expect(dotColor('interrupted', 'dark', { onLightSurface: true })).toBe('#57534e')
    expect(dotColor('unconfirmed', 'dark', { onLightSurface: true })).toBe('#b45309')
  })

  // The selected tab pill is the theme's text colour: light in the dark scheme, near-black in the
  // light one. A Stop's muted dot was the light scheme's own muted tone there, 2.81:1 on the
  // near-black pill. The flags are the ones MobileSessionHeader passes for the selected pill
  // (pinned in tab-pill-draws-turn-verdict.test.ts). WCAG 1.4.11 asks 3:1 of a graphic.
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)("keeps every verdict dot readable on the %s scheme's selected pill", (scheme, palette) => {
    const surface = { onLightSurface: scheme === 'dark', onDarkSurface: scheme === 'light' }
    for (const state of ['interrupted', 'unconfirmed', 'failed', 'blocked'] as const) {
      const tone = dotColor(state, scheme, surface)
      expect({ state, tone, readable: contrastRatio(String(tone), palette.text) >= 3 }).toEqual({
        state,
        tone,
        readable: true
      })
    }
  })
})
