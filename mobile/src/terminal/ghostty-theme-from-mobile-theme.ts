import type { TerminalTheme } from 'expo-libghostty'
import type { MobileTerminalTheme } from './terminal-webview-contract'
import { DEFAULT_TERMINAL_THEME } from './terminal-webview-html/theme'

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
 * The host sends the desktop's terminal palette per tab, light or dark, and
 * the WebView engine applies those colours directly — `mode` rides along as
 * metadata. This does the same for the ghostty engine, so a tab looks the
 * same whichever engine draws it: host overrides win, the app default fills
 * anything the host left unset, and libghostty's own defaults are never seen.
 */
export function ghosttyThemeFromMobileTheme(theme: MobileTerminalTheme | undefined): TerminalTheme {
  const merged: Overrides = { ...DEFAULT_TERMINAL_THEME, ...(theme?.theme ?? {}) }
  return {
    background: merged.background,
    foreground: merged.foreground,
    cursorColor: merged.cursor,
    selectionBackground: merged.selectionBackground,
    selectionForeground: merged.selectionForeground,
    palette: ANSI_ORDER.map((key) => merged[key] ?? null)
  }
}
