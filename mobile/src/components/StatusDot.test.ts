import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View'
}))

import { darkColors, lightColors } from '../theme/tokens'
import { statusDotColor } from './status-dot-tone'

describe('statusDotColor', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('keeps Relay progress amber when the raw state is disconnected (%s)', (_name, colors) => {
    expect(
      statusDotColor(colors, 'disconnected', { kind: 'normal', label: 'Connecting via Relay…' })
    ).toBe(colors.warning)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('keeps an idle disconnected host gray (%s)', (_name, colors) => {
    expect(statusDotColor(colors, 'disconnected', { kind: 'normal', label: 'Disconnected' })).toBe(
      colors.textMuted
    )
  })
})
