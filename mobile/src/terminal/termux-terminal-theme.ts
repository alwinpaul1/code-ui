import type { TermuxTerminalTheme } from '@codeui/expo-termux-terminal'
import type { MobileTerminalTheme } from './terminal-webview-contract'
import { DEFAULT_TERMINAL_THEME } from './terminal-webview-html/theme'

const HEX_RGB = /^#([0-9a-f]{6})$/i
const HEX_RGBA = /^#([0-9a-f]{6})[0-9a-f]{2}$/i
const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i
const RGB_FN = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.%]+\s*)?\)$/i

/**
 * Termux's colour parser takes `#rrggbb` (and `rgb:` X forms) and nothing else, and its scheme
 * update throws on the first value it cannot read after resetting the scheme to Termux's
 * defaults. The desktop's palette is CSS: usually `#rrggbb`, sometimes `#rrggbbaa` or
 * `rgba()`. This turns what it can into `#rrggbb` (alpha dropped: cells are opaque) and returns
 * null for the rest; `termuxThemeFromMobileTheme` then falls back to the app default for that
 * slot, so one unreadable colour costs that colour, not the whole theme.
 */
export function termuxColorFromCss(color: string | null | undefined): string | null {
  if (typeof color !== 'string') {
    return null
  }
  const value = color.trim()
  const rgb = HEX_RGB.exec(value) ?? HEX_RGBA.exec(value)
  if (rgb) {
    return `#${rgb[1].toLowerCase()}`
  }
  const short = HEX_SHORT.exec(value)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  }
  const fn = RGB_FN.exec(value)
  if (fn) {
    const channel = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0')
    return `#${channel(fn[1])}${channel(fn[2])}${channel(fn[3])}`
  }
  return null
}

type Overrides = MobileTerminalTheme['theme']

const ANSI_ORDER: readonly (keyof Overrides)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
]

/**
 * The desktop's palette for a tab, in the form the Termux scheme accepts: the host's colour
 * where Termux can read it, else the app default for that slot. The fallback is per slot and
 * AFTER parsing on purpose: a host `hsl()` background that merely replaced the default and then
 * failed to parse was dropped natively, and Termux's own default (black) filled the pane
 * (reviewed 2026-09-21).
 */
export function termuxThemeFromMobileTheme(theme: MobileTerminalTheme | undefined): TermuxTerminalTheme {
  const slot = (key: keyof Overrides): string | null =>
    termuxColorFromCss(theme?.theme[key]) ?? termuxColorFromCss(DEFAULT_TERMINAL_THEME[key])
  return {
    background: slot('background') ?? undefined,
    foreground: slot('foreground') ?? undefined,
    cursorColor: slot('cursor') ?? undefined,
    palette: ANSI_ORDER.map((key) => slot(key))
  }
}
