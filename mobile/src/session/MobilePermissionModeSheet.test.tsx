import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The Claude Android app's "Select mode" sheet (1.261009.20): Manual, Accept
// edits, Plan, Auto under "Choose how Claude should work"; Bypass is never a
// row; Auto is refused with "Not available for the selected model" when the
// running model is a Claude 3, or a Claude 4 up to 4.5.

type Action = { label: string; hint?: string; selected?: boolean; disabled?: boolean }
const sheetProps = vi.hoisted(() => [] as { message?: string; actions: Action[] }[])

vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { message?: string; actions: Action[] }) => {
    sheetProps.push(props)
    return null
  }
}))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))

import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  sheetProps.length = 0
})

function open(current: TerminalPermissionMode | null, runningModel?: string | null) {
  act(() => {
    renderer = create(
      createElement(MobilePermissionModeSheet, {
        visible: true,
        current,
        runningModel,
        onSelect: () => {},
        onClose: () => {}
      })
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

  it('never locks the row a session is already in', () => {
    const auto = open('auto', 'claude-sonnet-4-5').actions.find((a) => a.label === 'Auto')!
    expect(auto).toMatchObject({ disabled: false, selected: true })
  })
})
