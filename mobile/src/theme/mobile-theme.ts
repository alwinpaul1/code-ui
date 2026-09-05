// LEGACY static palette (dark only). Kept so screens not yet converted keep
// compiling; values are the Code UI warm-dark tokens so they blend with the
// themed screens in dark mode. New code must use `useTheme()` from
// theme-context instead — this object cannot follow the appearance setting.

export const colors = {
  bgBase: '#1A1917',
  bgPanel: '#211F1C',
  bgRaised: '#2B2925',
  borderSubtle: '#332F2A',
  editorSurface: '#1E1C19',

  textPrimary: '#ECE9E2',
  textSecondary: '#B8B4AB',
  textMuted: '#9A968D',

  // Crisp near-white surface for the single primary action on a screen (the
  // worktree FAB). Brighter than textPrimary so it reads as a solid button, not
  // disabled chrome, while staying monochrome (STYLEGUIDE: color is for state).
  surfaceBright: '#F3F1EA',

  accentBlue: '#D9825F',
  // Text/icon color on a filled accent (accentBlue) button, where the muted
  // textPrimary would lack contrast against the saturated fill.
  onAccent: '#1A1917',

  statusGreen: '#5FB57F',
  statusAmber: '#D9A441',
  statusRed: '#E06C5B',
  // Merge CTA fill + its on-fill text, mirroring the desktop ChecksPanel's
  // bg-green-600 "Squash and merge" button (green-600 / white).
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  // Merged-PR purple, mirroring the desktop ReviewIcon's purple-400/70 tone.
  statusPurple: '#a78bfa',
  gitDecorationAdded: '#81b88b',
  gitDecorationDeleted: '#c74e39',
  diffAddedBg: 'rgba(129, 184, 139, 0.1)',
  diffDeletedBg: 'rgba(199, 78, 57, 0.11)',

  syntaxComment: '#6a9955',
  syntaxKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxType: '#4ec9b0',
  syntaxFunction: '#dcdcaa',
  syntaxVariable: '#9cdcfe',
  syntaxMeta: '#c586c0',

  // Terminal WebView background (Tokyonight) — separate from app chrome
  terminalBg: '#1a1b26'
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
} as const

export const radii = {
  row: 6,
  card: 14,
  button: 6,
  input: 6,
  camera: 8
} as const

export const typography = {
  titleSize: 18,
  bodySize: 14,
  metaSize: 12,
  monoFamily: 'monospace' as const
} as const
