// The label of a destructive Button reads from the live theme in BOTH schemes. It was a literal
// #FFFFFF, which is 3.25:1 on the dark scheme's danger red (mobile-theme-contrast.test.ts pins the
// pair at 4.5:1). Every user of the danger variant goes through here: today the confirm sheets
// (ConfirmModal `destructive`), including the shell-command question.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))

import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { Button } from './Button'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function labelColor(scheme: 'light' | 'dark', variant: 'danger' | 'primary' | 'accent'): unknown {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Button label="Run" variant={variant} onPress={() => undefined} />
      </ThemeProvider>
    )
  })
  const text = renderer!.root.findAll((node) => (node.type as unknown) === 'Text')[0]!
  const flat = ([] as unknown[]).concat(text.props.style ?? []).flat(3).filter(Boolean)
  return Object.assign({}, ...(flat as object[])).color
}

describe('the label of a destructive button', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is the %s scheme\'s onDanger, not a literal', (scheme, colors) => {
    expect(labelColor(scheme, 'danger')).toBe(colors.onDanger)
  })

  it('differs between the schemes, where the fill does', () => {
    expect(labelColor('dark', 'danger')).not.toBe(labelColor('light', 'danger'))
  })

  it('leaves the other variants on their own tokens', () => {
    expect(labelColor('dark', 'primary')).toBe(darkColors.textInverse)
    expect(labelColor('dark', 'accent')).toBe(darkColors.onAccent)
  })
})
