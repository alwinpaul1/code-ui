import { describe, expect, it } from 'vitest'
import { prStateToken } from './pr-state-token'
import { prStateBadge } from './pr-sidebar/pr-checks-presentation'
import { statusColor } from './pr-sidebar/pr-sidebar-status-color'
import { darkColors, lightColors } from '../theme/tokens'

describe('prStateToken', () => {
  it('maps PR states to the desktop-matching status palette', () => {
    expect(prStateToken('merged')).toBe('statusPurple')
    expect(prStateToken('open')).toBe('statusGreen')
    expect(prStateToken('closed')).toBe('statusRed')
    expect(prStateToken('draft')).toBe('textSecondary')
  })

  it('is case-insensitive and falls back to muted for unknown states', () => {
    expect(prStateToken('MERGED')).toBe('statusPurple')
    expect(prStateToken('unknown')).toBe('textSecondary')
    expect(prStateToken('')).toBe('textSecondary')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('resolves to the expected concrete %s colors', (_scheme, palette) => {
    expect(statusColor(prStateToken('merged'), palette)).toBe(palette.mergedPurple)
    expect(statusColor(prStateToken('open'), palette)).toBe(palette.success)
    expect(statusColor(prStateToken('closed'), palette)).toBe(palette.danger)
    expect(statusColor(prStateToken('draft'), palette)).toBe(palette.textSecondary)
  })
})

describe('workspace-list and PR-sidebar palette agreement', () => {
  // Both surfaces must resolve the SAME color for the same state so the
  // linked-PR badge and the sidebar state badge never drift.
  it.each(['open', 'closed', 'merged', 'draft'] as const)(
    'sidebar badge and list badge agree for %s in both schemes',
    (state) => {
      for (const palette of [lightColors, darkColors]) {
        const listColor = statusColor(prStateToken(state), palette)
        const sidebarColor = statusColor(prStateBadge(state).token, palette)
        expect(sidebarColor).toBe(listColor)
      }
    }
  )
})
