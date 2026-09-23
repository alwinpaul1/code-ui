import { describe, expect, it, vi } from 'vitest'
import { colorsForScheme, fontFamily, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { makeChatMessageStyles } from './mobile-native-chat-message-styles'

vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }))

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: colorsForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

// 2026-09-24, from the phone beside the Claude app: the Claude app marks
// Claude's thinking with a thin, faint line; Code UI drew its note line 3 px in
// the strong border colour, "so subtle" there and heavy here. The desktop's
// reader hands a Claude thinking block over as ordinary assistant text, so the
// phone draws both under the note line; it must be the Claude app's weight.
describe('the line beside a note the agent worked past', () => {
  it.each(['light', 'dark'] as const)('is as thin and faint as the thinking line in %s', (scheme) => {
    const theme = themeFor(scheme)
    const styles = makeChatMessageStyles(theme) as unknown as Record<string, Record<string, unknown>>
    expect(styles.interimNote).toMatchObject({ borderLeftWidth: 2, borderLeftColor: theme.colors.border })
    expect(styles.interimNote!.borderLeftWidth).toBe(styles.reasoning!.borderLeftWidth)
    expect(styles.interimNote!.borderLeftColor).toBe(styles.reasoning!.borderLeftColor)
  })
})
