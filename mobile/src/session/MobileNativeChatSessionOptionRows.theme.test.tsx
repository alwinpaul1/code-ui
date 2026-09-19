// The one-switch boolean row from Orca #20506, in both themes. Upstream's own
// rows test (vendored beside this file) pins the switch, the marker and the
// accessible name; this fork draws the row from the theme instead of the
// static palette, so the colours are pinned here where a hardcoded one would
// pass every other check and still ship the wrong mode.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { DescriptorRows } from './MobileNativeChatSessionOptionRows'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight'
}))

const FAST: SessionOptionDescriptor = {
  id: 'fastMode',
  label: 'Fast mode',
  category: 'mode',
  kind: { type: 'boolean', currentValue: true },
  valueSource: 'unknown',
  transport: 'agent-session',
  settable: true
}

function textColors(renderer: ReactTestRenderer): string[] {
  const colors: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    const style = node.props.style
    for (const entry of Array.isArray(style) ? style.flat() : [style]) {
      if (entry && typeof entry === 'object' && typeof entry.color === 'string') {
        colors.push(entry.color)
      }
    }
  }
  return colors
}

describe('the Fast mode switch row', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its track and marker from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(DescriptorRows, {
            descriptor: FAST,
            disabled: false,
            onSetOption: vi.fn(),
            onInvokeAction: vi.fn()
          })
        )
      )
    })
    const toggle = renderer!.root.findByType('Switch')
    expect(toggle.props.value).toBe(true)
    expect(toggle.props.trackColor).toEqual({ false: palette.borderStrong, true: palette.accent })
    expect(toggle.props.thumbColor).toBe(palette.bgPanel)
    // "Not reported" sits in the muted tier of the same theme.
    expect(textColors(renderer!)).toContain(palette.textMuted)
  })

  it('hands the flipped value to the option setter', () => {
    const onSetOption = vi.fn()
    act(() => {
      renderer = create(
        createElement(DescriptorRows, {
          descriptor: FAST,
          disabled: false,
          onSetOption,
          onInvokeAction: vi.fn()
        })
      )
    })
    act(() => renderer!.root.findByType('Switch').props.onValueChange(false))
    expect(onSetOption).toHaveBeenCalledWith(false)
  })
})
