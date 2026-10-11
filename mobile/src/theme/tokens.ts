// Code UI design tokens. Warm cream / ink palette in the spirit of the Claude
// app, defined for BOTH schemes. Screens read these through `useTheme()`; a
// literal hex in a component is a bug because it silently ignores the user's
// appearance setting.

export type ThemeScheme = 'light' | 'dark'
export type ThemePreference = 'system' | ThemeScheme

export type ThemeColors = {
  /** Page canvas. */
  bg: string
  /** Cards, sheets, composer. */
  bgPanel: string
  /** Raised chips, pressed rows, icon wells. */
  bgRaised: string
  /** Inset wells: code, inputs. */
  bgSunken: string
  /** Scrim behind drawers. */
  bgOverlay: string
  /** The composer dock over the chat: the conversation shows through, as in
   *  the Claude app (2026-09-13). */
  bgDock: string
  /** The composer box on that dock: solid. Nothing shows through it, while
   *  the dock around it stays clear (2026-09-13). */
  bgPanelGlass: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textMuted: string
  /** Muted words in the chat transcript, exactly the Claude app's (`pl7.Q`,
   *  docs/claude-app-typography.md): a tool row's label and the thinking word
   *  on the status line. Light is 4.13:1 on `bg`, under the 4.5 `textMuted`
   *  keeps everywhere else; it is the app's own value, at 15 sp, beside the
   *  run's body text and never alone on a surface. */
  chatMuted: string
  /** The status line's "N running tasks" link, the Claude app's (`ad5.C0()`),
   *  the same blue as inline code. */
  chatLink: string
  textInverse: string
  /** Brand accent (terracotta). Fills, icons, focus. */
  accent: string
  /** Accent used as text on the canvas — darker for contrast. */
  accentText: string
  accentSoft: string
  onAccent: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  /** The label on a `danger` fill (a destructive button): 4.5:1 or better in both schemes. */
  onDanger: string
  dangerSoft: string
  info: string
  /** Merged-PR icon accent (violet, mirrors the desktop ReviewIcon's purple-400/70).
   *  The dark value (violet-400, #A78BFA) reads fine on the dark surfaces it was
   *  picked for, but at 2.4:1 on the light canvas it is well under the 3:1 floor
   *  for a UI icon — so light uses violet-600 instead, which clears 3:1 on both
   *  `bg` and `bgPanel` (mobile-theme-contrast-equivalent assertion in
   *  pr-sidebar-status-color.test.ts). */
  mergedPurple: string
  /** A sent prompt's card, as the Claude app fills it in a Code session
   *  (`pl7.w0`). */
  userBubble: string
  userBubbleText: string
  codeBg: string
  /** Inline `code` chips inside prose. Translucent on purpose: Android draws a
   *  text selection BEHIND the text, so an opaque span background hides the
   *  highlight and the code reads as the one thing that did not select
   *  (reported 2026-09-12). */
  codeSpanBg: string
  /** Inline `code` chip: text, fill and hairline border, after the Claude app. */
  codeSpanText: string
  codeSpanBorder: string
  /** The Claude app's hairline (`pl7.x`): the user card's border and the
   *  inline code chip's. */
  hairline: string
  diffAddBg: string
  diffAddText: string
  diffDelBg: string
  diffDelText: string
  /** Fallback behind the terminal WebView before the desktop theme arrives. */
  terminalBg: string
  shadow: string
  /** The dim behind the update dialog's card. Flat black at 28% in BOTH
   *  schemes: the card on it is solid (2026-10-10 redesign, "not glass"), so
   *  the dim only has to set it off from the page. Drawers keep the heavier
   *  `bgOverlay`. */
  alertScrim: string
}

export const lightColors: ThemeColors = {
  // The Claude app's light scheme (com.anthropic.claude 1.261009.20,
  // docs/claude-app-typography.md): page #F9F9F7, surface #FFFFFF, the user
  // card's #F0EFEC as the raised fill, the code body #F3F3F0 as the sunken
  // one. It was the warmer #F3F1EA family before 2026-10-11.
  bg: '#F9F9F7',
  bgPanel: '#FFFFFF',
  bgRaised: '#F0EFEC',
  bgSunken: '#F3F3F0',
  bgOverlay: 'rgba(30, 28, 25, 0.42)',
  bgDock: 'rgba(249, 249, 247, 0.72)',
  bgPanelGlass: 'rgba(255, 255, 255, 1)',
  border: '#E2E1DC',
  borderStrong: '#CBCAC4',
  text: '#131313',
  textSecondary: '#383835',
  // The app's muted (#7B7974) is 4.13:1 on its page; this is its hue taken
  // down to 4.5:1 or better on every surface (chatMuted keeps the app's own).
  textMuted: '#6B6965',
  chatMuted: '#7B7974',
  chatLink: '#184F95',
  textInverse: '#F9F9F7',
  accent: '#C96442',
  accentText: '#A5482A',
  accentSoft: '#F4E3DA',
  onAccent: '#FFFFFF',
  success: '#3B8A5A',
  successSoft: 'rgba(59, 138, 90, 0.14)',
  warning: '#B7791F',
  warningSoft: 'rgba(183, 121, 31, 0.14)',
  danger: '#C0392B',
  onDanger: '#FFFFFF',
  dangerSoft: 'rgba(192, 57, 43, 0.12)',
  info: '#3B6FB6',
  mergedPurple: '#7C3AED',
  userBubble: '#F0EFEC',
  userBubbleText: '#131313',
  codeBg: '#F3F3F0',
  codeSpanBg: 'rgba(11, 11, 11, 0.05)',
  codeSpanText: '#184F95',
  codeSpanBorder: 'rgba(30, 30, 29, 0.15)',
  hairline: 'rgba(30, 30, 29, 0.15)',
  diffAddBg: 'rgba(59, 138, 90, 0.14)',
  diffAddText: '#276640',
  diffDelBg: 'rgba(192, 57, 43, 0.12)',
  diffDelText: '#A43227',
  terminalBg: '#1A1B26',
  shadow: 'rgba(30, 28, 25, 0.18)',
  alertScrim: 'rgba(0, 0, 0, 0.28)'
}

export const darkColors: ThemeColors = {
  // The Claude app's dark scheme (docs/claude-app-typography.md): page
  // #151515, surface #20201F, the user card's #2C2C2A as the raised fill, the
  // code body #111111 as the sunken one. It was the warm #1A1917 family
  // before 2026-10-11.
  bg: '#151515',
  bgPanel: '#20201F',
  bgRaised: '#2C2C2A',
  bgSunken: '#111111',
  bgOverlay: 'rgba(0, 0, 0, 0.55)',
  bgDock: 'rgba(21, 21, 21, 0.72)',
  bgPanelGlass: 'rgba(32, 32, 31, 1)',
  border: '#343432',
  borderStrong: '#474744',
  // The Claude app's primary text (`pl7.O`), read from its code; the earlier
  // screenshot sample (248, 248, 246) was this less a step of anti-aliasing.
  text: '#F9F9F7',
  textSecondary: '#C3C2B7',
  textMuted: '#97958D',
  chatMuted: '#97958D',
  chatLink: '#6DA7EC',
  textInverse: '#151515',
  accent: '#D9825F',
  accentText: '#E39274',
  accentSoft: '#3A2A22',
  onAccent: '#151515',
  success: '#5FB57F',
  successSoft: 'rgba(95, 181, 127, 0.16)',
  warning: '#D9A441',
  warningSoft: 'rgba(217, 164, 65, 0.16)',
  danger: '#E06C5B',
  onDanger: '#151515',
  dangerSoft: 'rgba(224, 108, 91, 0.16)',
  info: '#7FA7E0',
  // Violet-400, the desktop ReviewIcon's tone, exactly as the sidebar always drew
  // it in dark (pinned by pr-sidebar-status-color.test.ts).
  mergedPurple: '#a78bfa',
  userBubble: '#2C2C2A',
  userBubbleText: '#F9F9F7',
  codeBg: '#111111',
  codeSpanBg: 'rgba(255, 255, 255, 0.075)',
  codeSpanText: '#6DA7EC',
  codeSpanBorder: 'rgba(225, 224, 217, 0.15)',
  hairline: 'rgba(225, 224, 217, 0.15)',
  diffAddBg: 'rgba(95, 181, 127, 0.14)',
  diffAddText: '#7FCB9B',
  diffDelBg: 'rgba(224, 108, 91, 0.14)',
  diffDelText: '#EE8B7B',
  terminalBg: '#1A1B26',
  shadow: 'rgba(0, 0, 0, 0.5)',
  alertScrim: 'rgba(0, 0, 0, 0.28)'
}

/** The brand red, now the notification tint (the mark itself is black or
 *  white per scheme, below). Sampled from assets/brand/mark-source.webp (241, 25, 36); app.json's
 *  adaptive-icon background and notification tint carry the same value, pinned
 *  by app-logo-assets.test.ts. Regenerate the icons with
 *  scripts/build-brand-assets.py if it ever moves. */
export const brand = {
  red: '#F11924',
  /** The in-app mark and the splash tile, per scheme (2026-10-11, following
   *  the launcher icon to black): black on light surfaces, white on dark ones,
   *  where black would vanish. The light value is the launcher tile's flat
   *  colour. app-logo-assets.test.ts pins the splash PNGs to these. */
  markLight: '#141414',
  markDark: '#FFFFFF'
} as const

/** Instrument Sans is the only UI face. Weights map to loaded font names, since
 *  React Native on Android picks a family per weight rather than synthesizing.
 *  Pure constants live here so the theme never imports expo-font (test safety). */
export const fontFamily = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
  // Bundled, not the platform alias: see `useAppFonts` for the Samsung reason.
  mono: 'JetBrainsMono_400Regular'
} as const

export type FontWeight = Exclude<keyof typeof fontFamily, 'mono'>

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999
} as const

/** Font sizes with the line height each one wants. */
export const type = {
  display: { size: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { size: 22, lineHeight: 28, letterSpacing: -0.4 },
  heading: { size: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { size: 15, lineHeight: 21, letterSpacing: 0 },
  label: { size: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { size: 12, lineHeight: 16, letterSpacing: 0.1 },
  mono: { size: 13, lineHeight: 18, letterSpacing: 0 }
} as const

export type TypeVariant = keyof typeof type

export function colorsForScheme(scheme: ThemeScheme): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors
}
