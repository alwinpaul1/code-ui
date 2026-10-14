import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  PixelRatio: { get: () => 3, getFontScale: () => 1 },
  Platform: { OS: 'android', Version: 34 },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))

import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import type { Theme } from '../theme/theme-context'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import {
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from '../settings/chat-reading-settings'

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

import {
  DEFAULT_MARKDOWN_TYPOGRAPHY,
  TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
  type MarkdownTypography
} from './mobile-markdown-prose-scale'
import { useMarkdownStyles, type MarkdownStyles } from './mobile-markdown-styles'

// The Claude app's "Transcript font" and "Code font" (gd9.java, a41.java:172-195): the choice is
// the transcript's, so a markdown surface that is not the transcript (the PR sidebar, the file
// reader, a plan card) keeps the faces the app has always drawn it in.

let drawn: MarkdownStyles | null = null
let renderer: ReactTestRenderer | null = null

function Probe({ typography }: { typography: MarkdownTypography }) {
  drawn = useMarkdownStyles(typography)
  return null
}

async function draw(typography: MarkdownTypography): Promise<MarkdownStyles> {
  await act(async () => {
    renderer = create(createElement(Probe, { typography }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return drawn!
}

function families(styles: MarkdownStyles): Record<string, unknown> {
  const flat = styles as unknown as Record<string, { fontFamily?: unknown }>
  return Object.fromEntries(
    ['paragraph', 'heading', 'bold', 'quoteText', 'listText', 'tableHeader', 'codeText', 'codeLabel', 'inlineCodeChipText'].map(
      (name) => [name, flat[name]?.fontFamily]
    )
  )
}

describe('the transcript font and code font choices', () => {
  beforeEach(() => {
    resetChatReadingSettingsForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    drawn = null
    resetChatReadingSettingsForTests()
  })

  it.each(['light', 'dark'] as const)('change nothing until one is chosen, in %s', async (which) => {
    scheme = which
    const styles = await draw(TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
    expect(families(styles)).toEqual({
      paragraph: fontFamily.regular,
      heading: fontFamily.semibold,
      bold: fontFamily.semibold,
      quoteText: fontFamily.regular,
      listText: fontFamily.regular,
      tableHeader: fontFamily.semibold,
      codeText: fontFamily.mono,
      codeLabel: fontFamily.mono,
      inlineCodeChipText: fontFamily.mono
    })
  })

  it.each(['light', 'dark'] as const)('draw the transcript in the system faces when both say System, in %s', async (which) => {
    scheme = which
    await saveChatReadingSettings({ transcriptFont: 'system', codeFont: 'system' })
    const styles = await draw(TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
    expect(families(styles)).toEqual({
      paragraph: 'sans-serif',
      heading: 'sans-serif-medium',
      bold: 'sans-serif-medium',
      quoteText: 'sans-serif',
      listText: 'sans-serif',
      tableHeader: 'sans-serif-medium',
      codeText: 'monospace',
      codeLabel: 'monospace',
      // The transcript's pill is set in the code face.
      inlineCodeChipText: 'monospace'
    })
  })

  it('keep the two apart: system prose beside JetBrains Mono code, and the reverse', async () => {
    await saveChatReadingSettings({ transcriptFont: 'system', codeFont: 'jetbrains_mono' })
    const first = families(await draw(TRANSCRIPT_MARKDOWN_TYPOGRAPHY))
    expect(first.paragraph).toBe('sans-serif')
    expect(first.codeText).toBe(fontFamily.mono)
    act(() => renderer?.unmount())
    await saveChatReadingSettings({ transcriptFont: 'instrument_sans', codeFont: 'system' })
    const second = families(await draw(TRANSCRIPT_MARKDOWN_TYPOGRAPHY))
    expect(second.paragraph).toBe(fontFamily.regular)
    expect(second.codeText).toBe('monospace')
  })

  it('reach a lead’s prompt in a user bubble, which is the transcript too', async () => {
    await saveChatReadingSettings({ transcriptFont: 'system' })
    expect(families(await draw(TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY)).paragraph).toBe('sans-serif')
  })

  it('leave every other markdown surface in the faces it has always had', async () => {
    await saveChatReadingSettings({ transcriptFont: 'system', codeFont: 'system' })
    const styles = await draw(DEFAULT_MARKDOWN_TYPOGRAPHY)
    expect(families(styles)).toMatchObject({
      paragraph: fontFamily.regular,
      heading: fontFamily.semibold,
      codeText: fontFamily.mono,
      codeLabel: fontFamily.mono
    })
  })
})
