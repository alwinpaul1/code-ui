import { describe, expect, it, vi } from 'vitest'

// The user, 2026-10-14: the Select mode sheet must draw the Claude app's colourful icon per mode.
// com.anthropic.claude 1.261009.20, decompiled:
//   - glyph per mode, `ky20.q` (ky20.java:923): Manual `D1` hand, Accept edits `u0` code,
//     Plan `b3` scroll, Auto and Bypass `W1` lightning (names from yt0.java, via plan/icon.sh).
//   - tint per mode, `ky20.h` (ky20.java:344-424): Accept edits `pl7.n0`, Plan `pl7.m0`,
//     Auto and Bypass `pl7.e`. Manual's row is `ky20.i(D1, pl7.P, ...)` in the four-row layout
//     (z8.java:365-377), the neutral secondary text colour.
//   - values, plan/tokens_pl7.md: n0 #9747FF both schemes; m0 #006666 both; e #C6613F light /
//     #D97757 dark; P #383835 light / #C3C2B7 dark.
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))

import { contrastRatio } from '../test/contrast'
import { darkColors, lightColors } from '../theme/tokens'
import { PERMISSION_MODE_ICONS, permissionModeTint } from './permission-mode-appearance'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

describe('the glyph each permission mode is drawn with', () => {
  it.each<[TerminalPermissionMode, string]>([
    ['manual', 'Hand'],
    ['default', 'Hand'],
    ['acceptEdits', 'Code'],
    ['plan', 'ScrollText'],
    ['auto', 'Zap'],
    ['bypassPermissions', 'Zap']
  ])('draws %s as %s', (mode, icon) => {
    expect(String(PERMISSION_MODE_ICONS[mode])).toBe(icon)
  })
})

describe.each([
  ['light', lightColors, { manual: '#383835', acceptEdits: '#9747FF', plan: '#006666', auto: '#C6613F' }],
  ['dark', darkColors, { manual: '#C3C2B7', acceptEdits: '#9747FF', plan: '#006666', auto: '#D97757' }]
] as const)('the mode tints in %s', (_scheme, colors, spec) => {
  it('pins the four tokens to the decompiled pl7 values', () => {
    expect([colors.modeManual, colors.modeAcceptEdits, colors.modePlan, colors.modeAuto]).toEqual([
      spec.manual,
      spec.acceptEdits,
      spec.plan,
      spec.auto
    ])
  })

  it.each<[TerminalPermissionMode, keyof typeof spec]>([
    ['manual', 'manual'],
    ['default', 'manual'],
    ['acceptEdits', 'acceptEdits'],
    ['plan', 'plan'],
    ['auto', 'auto'],
    ['bypassPermissions', 'auto']
  ])('tints %s from the %s token, not a literal', (mode, key) => {
    expect(permissionModeTint(colors, mode)).toBe(
      { manual: colors.modeManual, acceptEdits: colors.modeAcceptEdits, plan: colors.modePlan, auto: colors.modeAuto }[key]
    )
  })

  it('gives Manual a tone that reads on the sheet, which the three coloured ones do not all promise', () => {
    // Manual is the app's secondary text colour: it must clear text contrast on the sheet panel.
    expect(contrastRatio(colors.modeManual, colors.bgPanel)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the two schemes', () => {
  it('keep Manual and Auto apart, as the decompiled pair does, and the purple and teal alike', () => {
    expect(lightColors.modeManual).not.toBe(darkColors.modeManual)
    expect(lightColors.modeAuto).not.toBe(darkColors.modeAuto)
    expect(lightColors.modeAcceptEdits).toBe(darkColors.modeAcceptEdits)
    expect(lightColors.modePlan).toBe(darkColors.modePlan)
  })
})
