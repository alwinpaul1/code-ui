import { describe, expect, it } from 'vitest'
import { termuxColorFromCss, termuxThemeFromMobileTheme } from './termux-terminal-theme'
import { DEFAULT_TERMINAL_THEME } from './terminal-webview-html/theme'

describe('colours for the Termux scheme', () => {
  it('passes #rrggbb through and lowercases it', () => {
    expect(termuxColorFromCss('#C0CAF5')).toBe('#c0caf5')
  })

  it('drops the alpha of #rrggbbaa and rgba(), since cells are opaque', () => {
    expect(termuxColorFromCss('#c0caf580')).toBe('#c0caf5')
    expect(termuxColorFromCss('rgba(192, 202, 245, 0.5)')).toBe('#c0caf5')
    expect(termuxColorFromCss('rgb(192 202 245 / 50%)')).toBe('#c0caf5')
  })

  it('expands #rgb', () => {
    expect(termuxColorFromCss('#fa0')).toBe('#ffaa00')
  })

  it('returns null for what Termux cannot read instead of letting it reset the whole scheme', () => {
    // Termux's updateWith resets the scheme to its defaults and then throws on the first bad
    // value; a null here means the app default fills that slot and the rest of the theme lands.
    expect(termuxColorFromCss('transparent')).toBeNull()
    expect(termuxColorFromCss('hsl(220 50% 50%)')).toBeNull()
    expect(termuxColorFromCss(null)).toBeNull()
    expect(termuxColorFromCss('')).toBeNull()
  })

  it('falls back to the APP default, not Termux\'s, for a host colour it cannot read', () => {
    // Reviewed 2026-09-21: a null slot was dropped on the native side, and after the scheme
    // reset that slot held Termux's own default, so an `hsl()` background drew a black pane.
    const theme = termuxThemeFromMobileTheme({ mode: 'dark', theme: { background: 'hsl(230 20% 10%)' } })
    expect(theme.background).toBe('#1a1b26')
  })

  it('builds the 16-slot palette with host overrides on top of the app default', () => {
    const theme = termuxThemeFromMobileTheme({
      mode: 'dark',
      theme: { background: 'rgba(16,16,16,1)', red: '#F00', brightWhite: 'oklch(1 0 0)' }
    })
    expect(theme.background).toBe('#101010')
    expect(theme.palette).toHaveLength(16)
    expect(theme.palette[1]).toBe('#ff0000')
    expect(theme.palette[15]).toBe(termuxColorFromCss(DEFAULT_TERMINAL_THEME.brightWhite))
    expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/)
  })
})
