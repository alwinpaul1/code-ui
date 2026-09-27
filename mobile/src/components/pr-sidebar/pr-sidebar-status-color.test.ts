import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../test/contrast'
import { darkColors, lightColors } from '../../theme/tokens'
import { statusColor } from './pr-sidebar-status-color'

// The merged-PR purple is a UI icon, not body text, so the floor is WCAG's 3:1
// non-text-contrast minimum rather than the 4.5:1 body-text target.
const WCAG_UI_ICON = 3

describe('the merged-PR purple clears icon contrast on both surfaces it sits on', () => {
  it('reads at 2.4:1 on the light canvas if left at the dark scheme value (the regression this token fixes)', () => {
    // Pinned so nobody "simplifies" mergedPurple back to one shared hex: this is the exact
    // complaint (statusPurple #a78bfa is too faint on the light canvas) the token exists to fix.
    expect(contrastRatio(darkColors.mergedPurple, lightColors.bg)).toBeLessThan(WCAG_UI_ICON)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: clears 3:1 on both bg and bgPanel', (_scheme, palette) => {
    expect(contrastRatio(palette.mergedPurple, palette.bg)).toBeGreaterThanOrEqual(WCAG_UI_ICON)
    expect(contrastRatio(palette.mergedPurple, palette.bgPanel)).toBeGreaterThanOrEqual(WCAG_UI_ICON)
  })

  it('keeps the dark value exactly the desktop-mirroring violet-400 the sidebar always drew', () => {
    expect(darkColors.mergedPurple).toBe('#a78bfa')
  })

  it('resolves through statusColor for the merged badge token in both schemes', () => {
    expect(statusColor('statusPurple', lightColors)).toBe(lightColors.mergedPurple)
    expect(statusColor('statusPurple', darkColors)).toBe(darkColors.mergedPurple)
  })

  it('defaults to the dark palette for a caller outside the PR sidebar slice that has not been converted yet', () => {
    expect(statusColor('statusPurple')).toBe(darkColors.mergedPurple)
  })
})
