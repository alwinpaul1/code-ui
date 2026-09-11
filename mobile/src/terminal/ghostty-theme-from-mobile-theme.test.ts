import { describe, expect, it } from 'vitest'
import { ghosttyThemeFromMobileTheme } from './ghostty-theme-from-mobile-theme'
import { DEFAULT_TERMINAL_THEME } from './terminal-webview-html/theme'

describe('a tab looks the same whichever engine draws it', () => {
  it('draws the app default when the host sent no palette', () => {
    const theme = ghosttyThemeFromMobileTheme(undefined)

    expect(theme.background).toBe(DEFAULT_TERMINAL_THEME.background)
    expect(theme.foreground).toBe(DEFAULT_TERMINAL_THEME.foreground)
    expect(theme.cursorColor).toBe(DEFAULT_TERMINAL_THEME.cursor)
    expect(theme.palette).toHaveLength(16)
    expect(theme.palette?.[0]).toBe(DEFAULT_TERMINAL_THEME.black)
    expect(theme.palette?.[15]).toBe(DEFAULT_TERMINAL_THEME.brightWhite)
  })

  it('keeps a dark desktop palette as the desk set it', () => {
    const theme = ghosttyThemeFromMobileTheme({
      mode: 'dark',
      theme: { background: '#000000', foreground: '#eeeeee', red: '#ff5555' }
    })

    expect(theme.background).toBe('#000000')
    expect(theme.foreground).toBe('#eeeeee')
    expect(theme.palette?.[1]).toBe('#ff5555')
    // Anything the host left unset falls back to the app default, not to
    // libghostty's own palette.
    expect(theme.palette?.[2]).toBe(DEFAULT_TERMINAL_THEME.green)
  })

  it('keeps a light desktop palette as the desk set it', () => {
    // Light is a required state, not a variant: a light desk must not get a
    // dark background because the engine changed.
    const theme = ghosttyThemeFromMobileTheme({
      mode: 'light',
      theme: {
        background: '#ffffff',
        foreground: '#1a1a1a',
        cursor: '#1a1a1a',
        selectionBackground: '#cce0ff'
      }
    })

    expect(theme.background).toBe('#ffffff')
    expect(theme.foreground).toBe('#1a1a1a')
    expect(theme.cursorColor).toBe('#1a1a1a')
    expect(theme.selectionBackground).toBe('#cce0ff')
  })

  it('lays the ANSI palette out in the order libghostty indexes it', () => {
    const theme = ghosttyThemeFromMobileTheme({
      mode: 'dark',
      theme: { black: '#0', red: '#1', green: '#2', yellow: '#3', blue: '#4', magenta: '#5', cyan: '#6', white: '#7' }
    })

    expect(theme.palette?.slice(0, 8)).toEqual(['#0', '#1', '#2', '#3', '#4', '#5', '#6', '#7'])
  })
})
