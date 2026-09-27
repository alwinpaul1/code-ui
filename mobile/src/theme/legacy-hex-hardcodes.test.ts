import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The host screen's style module builds its sheets with react-native's StyleSheet, whose real
// entry Node cannot parse; the label constant is all this file reads from it.
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } }))

import { ON_DESTRUCTIVE_FILL } from '../host-screen/host-screen-secondary-styles'
import { darkColors, lightColors } from './tokens'

const SRC = join(import.meta.dirname, '..')

/** Files the 0.6.6 audit named for a colour literal sitting where a token
 *  belongs. The other ~60 hex literals in the app are agent, repo, task and
 *  xterm hues, not surfaces, and are not this list's business. */
const AUDITED = [
  'host-screen/host-screen-secondary-styles.ts',
  'components/MobileHtmlPreview.tsx',
  'session/MobileSessionMarkdownReader.tsx'
]

/** A style property whose value is a hex literal: `color: '#fff'`. A named
 *  constant defined once with its reason (`const X = '#ffffff'`) does not
 *  match; the property then reads `backgroundColor: X`. */
const HEX_IN_STYLE = /\b(color|backgroundColor|borderColor|tintColor):\s*'#[0-9a-fA-F]{3,8}'/g

describe('colour literals in the audited files', () => {
  it('sit in no style property; every colour there is a token or a named constant', () => {
    const offenders = AUDITED.flatMap((file) => {
      const source = readFileSync(join(SRC, file), 'utf8')
      return [...source.matchAll(HEX_IN_STYLE)].map(
        (match) => `${file}:${source.slice(0, match.index).split('\n').length} ${match[0]}`
      )
    })
    expect(offenders).toEqual([])
  })

  it('still reads the files it audits, so an emptied list cannot pass', () => {
    expect(AUDITED).toHaveLength(3)
    for (const file of AUDITED) {
      expect(readFileSync(join(SRC, file), 'utf8').length).toBeGreaterThan(0)
    }
  })
})

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  )
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

// The host list's Delete confirmation paints the theme's `danger` fill, so
// its label is measured against that fill, not the page. Until 2026-09-27
// this read the static palette's `onStatusRed` / `statusRed`, which were the
// dark scheme's values; the light fill is the half it never measured.
describe('the destructive confirmation label', () => {
  it('is white on red like the platform’s own, in both schemes', () => {
    expect(ON_DESTRUCTIVE_FILL).toBe('#ffffff')
  })

  it.each([
    ['light', lightColors, 5.4],
    ['dark', darkColors, 3.2]
  ] as const)(
    '%s: clears the 3:1 floor for a bold label on its fill (dark does not reach 4.5:1; white on that red is 3.25:1, and iOS ships 3.0:1 for the same control)',
    (_scheme, palette, measured) => {
      const ratio = contrastRatio(ON_DESTRUCTIVE_FILL, palette.danger)
      expect(ratio).toBeGreaterThanOrEqual(3)
      expect(ratio).toBeGreaterThanOrEqual(measured)
    }
  )
})
