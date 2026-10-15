import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The context ring on a Claude tab matched to its Anthropic session draws the Claude app's
 * colour bands (com.anthropic.claude 1.261013.20, jadx, read 2026-10-15):
 *
 *   v7a.java:19-27   ContextFill -> ContextRing(percentUsed, variant): the reported percentage, or
 *                    round(used * 100 / window), clamped to 0..100; NORMAL under 75, WARNING from
 *                    75, CRITICAL from 90 (stepped, not faded)
 *   zn30.java:380    NORMAL -> Accent, WARNING -> Warning, CRITICAL -> Danger
 *   q95.java:7-42    Accent `ad5.e()` #2A78D6, Warning `ad5.g()` #FAB219, Danger `ad5.G()` #D03B3B
 *                    (w55/v55: the same three in light and dark)
 *
 * The user's screenshots: the app's ring was blue, later yellow; Code UI's was orange, because
 * the ring faded green -> amber -> red from 70 (use-usage-progress.ts). Here the bands map to the
 * theme's `info`, `warning` and `danger`, so the ring follows light and dark. A Codex tab (no
 * `bands`) keeps the fade.
 */

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ContextWindowRing } from '../components/ContextWindowRing'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(scheme: 'light' | 'dark', usedPercent: number, bands: boolean): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(ContextWindowRing, { usedPercent, bands })}
      </ThemeProvider>
    )
  })
  return renderer!.root
}

/** The arc: the second circle, whose stroke and dash the animated props carry. */
function arc(root: ReactTestInstance): { stroke: string; offset: number; circumference: number } {
  const circles = root.findAll((node) => (node.type as unknown) === 'Circle')
  const props = circles[1]!.props as { animatedProps: { stroke: string; strokeDashoffset: number }; r: number }
  return { stroke: props.animatedProps.stroke, offset: props.animatedProps.strokeDashoffset, circumference: 2 * Math.PI * props.r }
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a matched Claude tab’s context ring in %s mode', (scheme, palette) => {
  it('is blue (the app’s Accent) and empty at 0%', () => {
    const ring = arc(draw(scheme, 0, true))
    expect(ring.stroke).toBe(palette.info)
    expect(ring.offset).toBeCloseTo(ring.circumference)
  })

  it('stays blue up to 74%, where Code UI used to draw amber from 70', () => {
    expect(arc(draw(scheme, 40, true)).stroke).toBe(palette.info)
    expect(arc(draw(scheme, 72, true)).stroke).toBe(palette.info)
    expect(arc(draw(scheme, 74, true)).stroke).toBe(palette.info)
  })

  it('turns yellow (the app’s Warning) at 75% and stays yellow to 89%', () => {
    expect(arc(draw(scheme, 75, true)).stroke).toBe(palette.warning)
    expect(arc(draw(scheme, 89, true)).stroke).toBe(palette.warning)
  })

  it('steps on the whole percent the app shows: 74.6 reads 75 and is yellow, 74.4 is blue', () => {
    expect(arc(draw(scheme, 74.6, true)).stroke).toBe(palette.warning)
    expect(arc(draw(scheme, 74.4, true)).stroke).toBe(palette.info)
  })

  it('turns red (the app’s Danger) at 90%', () => {
    expect(arc(draw(scheme, 90, true)).stroke).toBe(palette.danger)
  })

  it('is red and full at 100%, and a figure past 100 is held there', () => {
    const full = arc(draw(scheme, 100, true))
    expect(full.stroke).toBe(palette.danger)
    expect(full.offset).toBeCloseTo(0)
    const over = arc(draw(scheme, 140, true))
    expect(over.stroke).toBe(palette.danger)
    expect(over.offset).toBeCloseTo(0)
  })

  it('a Codex tab’s ring keeps its own green -> amber -> red fade', () => {
    expect(arc(draw(scheme, 0, false)).stroke).toBe(palette.success)
    expect(arc(draw(scheme, 100, false)).stroke).toBe(palette.danger)
  })
})
