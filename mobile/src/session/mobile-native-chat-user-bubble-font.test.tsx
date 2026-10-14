import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))

import {
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from '../settings/chat-reading-settings'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import type { Theme } from '../theme/theme-context'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

let scheme: 'light' | 'dark' = 'light'
vi.mock('../theme/theme-context', () => ({ useTheme: () => themeFor(scheme) }))

import { useChatMessageStyles, type ChatMessageStyles } from './mobile-native-chat-message-styles'

// A sent prompt's words are the transcript too: the Claude app's "Transcript font" is not only
// for the replies. Tool rows, chips and the rest of the chat's chrome are the app's own UI face.

let drawn: ChatMessageStyles | null = null
let renderer: ReactTestRenderer | null = null

function Probe() {
  drawn = useChatMessageStyles()
  return null
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  drawn = null
  resetChatReadingSettingsForTests()
})

async function draw(): Promise<ChatMessageStyles> {
  await act(async () => {
    renderer = create(createElement(Probe))
    await Promise.resolve()
    await Promise.resolve()
  })
  return drawn!
}

describe('a sent prompt’s face', () => {
  it.each(['light', 'dark'] as const)('is Instrument Sans until the transcript font is changed, in %s', async (which) => {
    scheme = which
    expect((await draw()).userText.fontFamily).toBe(fontFamily.regular)
  })

  it.each(['light', 'dark'] as const)('follows the transcript font set to System, in %s', async (which) => {
    scheme = which
    resetChatReadingSettingsForTests()
    await saveChatReadingSettings({ transcriptFont: 'system' })
    const styles = await draw()
    expect(styles.userText.fontFamily).toBe('sans-serif')
    // The chat's chrome keeps the app's face: only the words are the reader's choice.
    expect(styles.userText.color).toBe(themeFor(which).colors.userBubbleText)
  })
})
