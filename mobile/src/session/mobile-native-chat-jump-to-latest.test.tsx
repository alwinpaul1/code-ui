import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors, radius, space, type ThemeColors } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'

// The chat's ↓ jump button, matched to the Claude Android app 1.261009.20
// (decompiled with jadx; file:line below is in out/sources/defpackage/).
// Reported 2026-10-15: "the ↓ jump button isn't fixed yet, copy that from
// Claude". Before this, ours was a lucide 18 dp arrow in a 1 dp bordered
// `bgPanel` circle with a 3 dp shadow, 12 dp above the dock, that popped in and
// out with no motion.
//
// Claude's values, each read from the decompile:
//   - gc20.java:44-51  the shared composable `gc20.c`: content description
//     generic_button_scroll_to_bottom, shown through AnimatedVisibility with
//     enter `mm7.c` and exit `mm7.d`.
//   - c6b.java:915-960 (case 7)  a 40 dp circle (`ixv.p(mwl, 40)`), shape
//     `mfs.a` = a(50) (50 %), icon `a95.e.j` = "arrowDown" (yt0.java:20,
//     codepoint 57353) at `au0.Small` = 16 dp, tinted `en7.a.O` (pl7.O).
//   - p54.java:195-221 (`p54.L`)  fill `en7.a.p` at 96 % (p54.java:223-226,
//     pl7.p), border `ees.b(0.5f, pl7.x)` (p54.java:195-198), shadow `an7.c`.
//   - an7.java:18  shadow vav(8 dp blur, black at 10 %, offset (0, 2 dp)).
//   - mm7.java:20-22  enter = scaleIn(0.01) + fadeIn, exit = scaleOut(0) +
//     fadeOut, both on tyl.java:6 `hay.A(0, 400, null, 5)` = spring(damping
//     ratio 1.0 (the default), stiffness 400). The 150 ms / 250 ms tweens in
//     mm7.java:23-25 (e, f, g, h) are NOT this button's: gc20.c passes c and d.
//   - pl7 light/dark values: scratchpad/plan/tokens_pl7.md (p #FFFFFF /
//     #20201F, O #131313 / #F9F9F7, x #1E1E1D / #E1E0D9 at 15 %).
//   - cp6.java:2658 (the regular chat's call): BottomCenter (`jbg.E`), inside
//     the scaffold padding, with 8 dp of bottom padding (`rrb.S(..., 8.0f, 7)`).

const springs: Array<{ config: Record<string, unknown>; done: ((result: { finished: boolean }) => void) | undefined }> = []

vi.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
    Value: class {
      constructor(public value: number) {}
      setValue(next: number) {
        this.value = next
      }
      interpolate(config: unknown) {
        return { interpolated: config }
      }
    },
    spring: (_value: unknown, config: Record<string, unknown>) => ({
      start: (done?: (result: { finished: boolean }) => void) => {
        springs.push({ config, done })
      },
      stop: () => undefined
    })
  },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ ArrowDown: 'ArrowDown' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../theme/theme-context', () => ({ useTheme: () => ({}), useThemedStyles: () => ({}) }))

import { MobileNativeChatJumpToLatest } from './mobile-native-chat-list-edges'
import { makeChatViewStyles } from './mobile-native-chat-view-styles'

const schemes: Array<[string, ThemeColors]> = [
  ['light', lightColors],
  ['dark', darkColors]
]

function fabStyle(colors: ThemeColors): Record<string, unknown> {
  const styles = makeChatViewStyles({ colors, space, radius } as unknown as Theme)
  return styles.fab as unknown as Record<string, unknown>
}

describe.each(schemes)('the jump-to-latest button, %s scheme', (_name, colors) => {
  it('is a 40 dp circle filled like the composer, not the panel colour', () => {
    const fab = fabStyle(colors)
    expect(fab).toMatchObject({ width: 40, height: 40, borderRadius: 20 })
    // pl7.p at 96 %, the same token the composer box wears.
    expect(fab.backgroundColor).toBe(colors.composerFill)
  })

  it('wears the composer hairline at half a dp, not a full dp border', () => {
    expect(fabStyle(colors)).toMatchObject({ borderWidth: 0.5, borderColor: colors.composerBorder })
  })

  it('casts the 8 dp, 10 % black, 2 dp down shadow', () => {
    const fab = fabStyle(colors)
    expect(fab).toMatchObject({
      shadowColor: 'rgba(0, 0, 0, 0.1)',
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 }
    })
    expect(colors.jumpButtonShadow).toBe('rgba(0, 0, 0, 0.1)')
  })

  it('draws a 16 dp arrow in the primary text colour pl7.O', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(MobileNativeChatJumpToLatest, {
          visible: true,
          onPress: vi.fn(),
          styles: { fab: {} },
          colors
        })
      )
    })
    const arrow = renderer.root.find((node) => String(node.type) === 'ArrowDown')
    expect(arrow.props.size).toBe(16)
    expect(arrow.props.color).toBe(colors.jumpButtonGlyph)
    act(() => renderer.unmount())
  })
})

describe('the jump-to-latest button tokens', () => {
  it('take pl7.O in both schemes', () => {
    expect(lightColors.jumpButtonGlyph).toBe('#131313')
    expect(darkColors.jumpButtonGlyph).toBe('#F9F9F7')
  })
})

describe('the jump-to-latest button motion', () => {
  let renderer: ReactTestRenderer | null = null
  const onPress = vi.fn()
  const mount = (visible: boolean) =>
    createElement(MobileNativeChatJumpToLatest, { visible, onPress, styles: { fab: {} }, colors: lightColors })

  beforeEach(() => {
    springs.length = 0
    onPress.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('draws nothing, and starts no animation, while it has never been shown', () => {
    act(() => {
      renderer = create(mount(false))
    })
    expect(renderer!.toJSON()).toBeNull()
    expect(springs).toHaveLength(0)
  })

  it('scales and fades in on a critically damped spring of stiffness 400', () => {
    act(() => {
      renderer = create(mount(false))
    })
    act(() => renderer!.update(mount(true)))
    expect(renderer!.toJSON()).not.toBeNull()
    expect(springs).toHaveLength(1)
    // Compose spring(dampingRatio 1, stiffness 400) is damping 2 * sqrt(400 * 1).
    expect(springs[0]!.config).toMatchObject({ toValue: 1, stiffness: 400, damping: 40, mass: 1, useNativeDriver: true })
  })

  it('stays on screen while it scales out, and leaves once the exit settles', () => {
    act(() => {
      renderer = create(mount(true))
    })
    act(() => renderer!.update(mount(false)))
    expect(springs.at(-1)!.config).toMatchObject({ toValue: 0, stiffness: 400, damping: 40 })
    expect(renderer!.toJSON()).not.toBeNull()
    act(() => springs.at(-1)!.done?.({ finished: true }))
    expect(renderer!.toJSON()).toBeNull()
  })

  it('stays mounted when it is called back before the exit settles', () => {
    act(() => {
      renderer = create(mount(true))
    })
    act(() => renderer!.update(mount(false)))
    const interrupted = springs.at(-1)!
    act(() => renderer!.update(mount(true)))
    act(() => interrupted.done?.({ finished: false }))
    expect(renderer!.toJSON()).not.toBeNull()
  })

  it('hands a tap to onPress, which jumps to the tail', () => {
    act(() => {
      renderer = create(mount(true))
    })
    const press = renderer!.root.find((node) => String(node.type) === 'Pressable')
    act(() => press.props.onPress())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('ignores taps while it scales out', () => {
    act(() => {
      renderer = create(mount(true))
    })
    act(() => renderer!.update(mount(false)))
    const holder = renderer!.root.find((node) => String(node.type) === 'AnimatedView')
    expect(holder.props.pointerEvents).toBe('none')
  })
})
