import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ScrollView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (s: unknown) => s },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('../ui/PressScale', async () => {
  const React = await import('react')
  return { PressScale: ({ children, ...props }: { children?: ReactNode }) => React.createElement('PressScale', props, children) }
})

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import type { ClaudeSessionFilter } from '../session/claude-session-state'
import { ClaudeSessionFilterChips } from './ClaudeSessionFilterChips'

// The Claude app's session filter row (session_filter_*), drawn over the workspace list with Code
// UI's own Chip. Each state chip carries its status dot in a theme token, so light and dark each
// draw their own; a hardcoded hue would pass every other check and still ignore the theme.
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function mount(scheme: 'light' | 'dark', value: ClaudeSessionFilter, onChange = vi.fn()) {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(ClaudeSessionFilterChips, { value, onChange })}</ThemeProvider>
    )
  })
  return onChange
}

const chips = (): ReactTestInstance[] => renderer!.root.findAll((node) => String(node.type) === 'PressScale')
const dotOf = (chip: ReactTestInstance) => chip.findAll((node) => String(node.type) === 'View' && node.props.testID === 'claude-session-filter-dot')[0]

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the session filter chips in %s mode', (scheme, palette) => {
  it('lists the app’s filters in its order and marks the one in use', async () => {
    await mount(scheme, 'needs-input')
    expect(chips().map((chip) => chip.props.accessibilityLabel)).toEqual(['All', 'Working', 'Needs input', 'Ready for review', 'Completed'])
    expect(chips().map((chip) => chip.props.accessibilityState.selected)).toEqual([false, false, true, false, false])
  })

  it('draws each state’s dot in the theme’s own token, and none on All', async () => {
    await mount(scheme, 'all')
    const [all, working, needsInput, review, completed] = chips()
    expect(dotOf(all!)).toBeUndefined()
    expect(dotOf(working!)!.props.style).toMatchObject({ backgroundColor: palette.warning })
    expect(dotOf(needsInput!)!.props.style).toMatchObject({ backgroundColor: palette.danger })
    expect(dotOf(review!)!.props.style).toMatchObject({ backgroundColor: palette.info })
    expect(dotOf(completed!)!.props.style).toMatchObject({ backgroundColor: palette.success })
  })

  it('changes the filter on a tap', async () => {
    const onChange = await mount(scheme, 'all')
    act(() => chips()[3]!.props.onPress())
    expect(onChange).toHaveBeenCalledWith('ready-for-review')
  })
})
