// Scheme-independent layout constants: spacing, corner radii and type sizes.
//
// There are no colours here. A static `colors` palette (dark only) lived in
// this file until 2026-09-27, and every screen that imported it drew dark in a
// light session while types, tests and the render all passed. Colours come
// from the live theme: `useTheme().colors` / `useThemedStyles(factory)` from
// theme-context, over `lightColors` / `darkColors` in tokens.ts. With the
// export gone, an import of `colors` from this module fails typecheck.

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
  monoFamily: 'JetBrainsMono_400Regular' as const
} as const
