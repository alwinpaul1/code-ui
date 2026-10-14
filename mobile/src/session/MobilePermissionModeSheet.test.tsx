import type { ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The Claude Android app's "Select mode" sheet (1.261009.20): Manual, Accept
// edits, Plan, Auto under "Choose how Claude should work"; Bypass is never a
// row; Auto is refused with "Not available for the selected model" when the
// running model is a Claude 3, or a Claude 4 up to 4.5.

type Action = {
  label: string
  hint?: string
  selected?: boolean
  disabled?: boolean
  closeBeforePress?: boolean
  renderIcon?: () => ReactElement<{ size: number; color: string }>
}
const sheetProps = vi.hoisted(() => [] as { message?: string; actions: Action[] }[])

vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { message?: string; actions: Action[] }) => {
    sheetProps.push(props)
    return null
  }
}))
vi.mock('react-native', () => ({ useColorScheme: () => 'light' }))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  sheetProps.length = 0
})

function open(
  current: TerminalPermissionMode | null,
  runningModel?: string | null,
  scheme: 'light' | 'dark' = 'light'
) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobilePermissionModeSheet
          visible
          current={current}
          runningModel={runningModel}
          onSelect={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>
    )
  })
  return sheetProps.at(-1)!
}

describe('the Select mode sheet', () => {
  it('says how Claude should work under the title', () => {
    expect(open('manual').message).toBe('Choose how Claude should work')
  })

  it('never lists Bypass, even on a session started in it', () => {
    const sheet = open('bypassPermissions')
    expect(sheet.actions.map((a) => a.label)).toEqual(['Manual', 'Accept edits', 'Plan', 'Auto'])
    expect(sheet.actions.some((a) => a.selected)).toBe(false)
  })

  it('refuses Auto for a model too old for it, in the Claude app’s words', () => {
    for (const model of ['claude-sonnet-4-5', 'claude-opus-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-haiku-4-5-20251001']) {
      const auto = open('manual', model).actions.find((a) => a.label === 'Auto')!
      expect(auto, model).toMatchObject({ disabled: true, hint: 'Not available for the selected model' })
    }
  })

  it('keeps Auto open for a newer model, an alias, or no model read yet', () => {
    for (const model of ['claude-opus-5-5', 'claude-opus-4-6', 'claude-sonnet-4-8', 'opus', null]) {
      const auto = open('manual', model).actions.find((a) => a.label === 'Auto')!
      expect(auto, String(model)).toMatchObject({ disabled: false, hint: 'Claude handles permission decisions' })
    }
  })

  // Opus review, 2026-10-12: Auto can open the opt-in sheet, and a second
  // modal opened in the same beat as this one closes can be dropped. The row
  // waits for this sheet to finish closing, as every sheet-from-a-sheet does.
  it('lets Auto run only after the sheet has closed, and the other rows at once', () => {
    const rows = open('manual').actions
    expect(rows.map((a) => [a.label, a.closeBeforePress === true])).toEqual([
      ['Manual', false],
      ['Accept edits', false],
      ['Plan', false],
      ['Auto', true]
    ])
  })

  it('never locks the row a session is already in', () => {
    const auto = open('auto', 'claude-sonnet-4-5').actions.find((a) => a.label === 'Auto')!
    expect(auto).toMatchObject({ disabled: false, selected: true })
  })
})

// The user, 2026-10-14: the sheet's icons are the Claude app's colourful ones. `ky20.i` draws
// each row's glyph (24 dp, `au0.Large` by default in `tzh.e`) tinted by the row's mode colour,
// and falls back to the plain content colour when the row is not open (`rrh` case 1, rrh.java:
// 52-59). The tint is the mode's, not the selection's: the selected row keeps it.
describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the Select mode sheet icons, %s', (scheme, colors) => {
  const ROWS: [string, string, string][] = [
    ['Manual', 'Hand', colors.modeManual],
    ['Accept edits', 'Code', colors.modeAcceptEdits],
    ['Plan', 'ScrollText', colors.modePlan],
    ['Auto', 'Zap', colors.modeAuto]
  ]

  it.each(ROWS)('draws %s as a 24 dp %s in its mode colour', (label, glyph, tint) => {
    const row = open('manual', null, scheme).actions.find((a) => a.label === label)!
    const icon = row.renderIcon!()
    expect(String(icon.type)).toBe(glyph)
    expect(icon.props).toMatchObject({ size: 24, color: tint })
  })

  it('gives each row its own colour, so the four are told apart at a glance', () => {
    const tints = open('manual', null, scheme).actions.map((a) => a.renderIcon!().props.color)
    expect(new Set(tints).size).toBe(4)
  })

  it('keeps a row’s colour when it is the selected one, and marks only that row', () => {
    for (const [mode, label, tint] of [
      ['manual', 'Manual', colors.modeManual],
      ['acceptEdits', 'Accept edits', colors.modeAcceptEdits],
      ['plan', 'Plan', colors.modePlan],
      ['auto', 'Auto', colors.modeAuto]
    ] as const) {
      const actions = open(mode, null, scheme).actions
      expect(actions.filter((a) => a.selected).map((a) => a.label), mode).toEqual([label])
      expect(actions.find((a) => a.selected)!.renderIcon!().props.color, mode).toBe(tint)
    }
  })

  it('marks Manual for a bare default, the way the sheet already read it', () => {
    expect(open('default', null, scheme).actions.filter((a) => a.selected).map((a) => a.label)).toEqual(['Manual'])
  })

  it('draws a refused Auto row in the plain muted tone, not the clay', () => {
    const auto = open('manual', 'claude-sonnet-4-5', scheme).actions.find((a) => a.label === 'Auto')!
    expect(auto.disabled).toBe(true)
    expect(auto.renderIcon!().props.color).toBe(colors.textMuted)
  })

  it('still draws Auto in the clay when the session is already in it on an old model', () => {
    const auto = open('auto', 'claude-sonnet-4-5', scheme).actions.find((a) => a.label === 'Auto')!
    expect(auto.renderIcon!().props.color).toBe(colors.modeAuto)
  })
})
