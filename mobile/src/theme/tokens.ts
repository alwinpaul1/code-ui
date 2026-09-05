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
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textMuted: string
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
  dangerSoft: string
  info: string
  /** The user's own message bubble. */
  userBubble: string
  userBubbleText: string
  codeBg: string
  diffAddBg: string
  diffAddText: string
  diffDelBg: string
  diffDelText: string
  /** Fallback behind the terminal WebView before the desktop theme arrives. */
  terminalBg: string
  shadow: string
}

export const lightColors: ThemeColors = {
  bg: '#F3F1EA',
  bgPanel: '#FBFAF6',
  bgRaised: '#EAE7DE',
  bgSunken: '#ECE9E1',
  bgOverlay: 'rgba(30, 28, 25, 0.42)',
  border: '#E1DDD2',
  borderStrong: '#CCC7BB',
  text: '#1E1C19',
  textSecondary: '#55514A',
  textMuted: '#67625A',
  textInverse: '#F7F5EF',
  accent: '#C96442',
  accentText: '#A5482A',
  accentSoft: '#F4E3DA',
  onAccent: '#FFFFFF',
  success: '#3B8A5A',
  successSoft: 'rgba(59, 138, 90, 0.14)',
  warning: '#B7791F',
  warningSoft: 'rgba(183, 121, 31, 0.14)',
  danger: '#C0392B',
  dangerSoft: 'rgba(192, 57, 43, 0.12)',
  info: '#3B6FB6',
  userBubble: '#E6E2D7',
  userBubbleText: '#1E1C19',
  codeBg: '#ECE9E0',
  diffAddBg: 'rgba(59, 138, 90, 0.14)',
  diffAddText: '#2F7A4D',
  diffDelBg: 'rgba(192, 57, 43, 0.12)',
  diffDelText: '#B0362A',
  terminalBg: '#1A1B26',
  shadow: 'rgba(30, 28, 25, 0.18)'
}

export const darkColors: ThemeColors = {
  bg: '#1A1917',
  bgPanel: '#211F1C',
  bgRaised: '#2B2925',
  bgSunken: '#161513',
  bgOverlay: 'rgba(0, 0, 0, 0.55)',
  border: '#332F2A',
  borderStrong: '#45403A',
  text: '#ECE9E2',
  textSecondary: '#B8B4AB',
  textMuted: '#9A968D',
  textInverse: '#1A1917',
  accent: '#D9825F',
  accentText: '#E39274',
  accentSoft: '#3A2A22',
  onAccent: '#1A1917',
  success: '#5FB57F',
  successSoft: 'rgba(95, 181, 127, 0.16)',
  warning: '#D9A441',
  warningSoft: 'rgba(217, 164, 65, 0.16)',
  danger: '#E06C5B',
  dangerSoft: 'rgba(224, 108, 91, 0.16)',
  info: '#7FA7E0',
  userBubble: '#2E2B26',
  userBubbleText: '#ECE9E2',
  codeBg: '#26231F',
  diffAddBg: 'rgba(95, 181, 127, 0.14)',
  diffAddText: '#7FCB9B',
  diffDelBg: 'rgba(224, 108, 91, 0.14)',
  diffDelText: '#EE8B7B',
  terminalBg: '#1A1B26',
  shadow: 'rgba(0, 0, 0, 0.5)'
}

/** Instrument Sans is the only UI face. Weights map to loaded font names, since
 *  React Native on Android picks a family per weight rather than synthesizing.
 *  Pure constants live here so the theme never imports expo-font (test safety). */
export const fontFamily = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
  mono: 'monospace'
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
