import type { ThemeColors, ThemeScheme } from '../../theme/tokens'

/**
 * The one mermaid configuration both hosts run.
 *
 * The native document splices it into the inline script it builds; the page hands the same object
 * to `mermaid.initialize`. Written down twice these would drift, and the drift would be a diagram
 * that looks different on the page from the one on the phone. Both callers resolve it from the live
 * theme (`useTheme()`) so a diagram opened in light mode draws light, not the dark-only look it had
 * before — mermaid ships no "follow the OS" mode, so this picks mermaid's own light/dark theme by
 * `scheme` and hands it the palette's surface/text colours.
 *
 * `suppressErrorRendering` because a diagram that throws is a source box on both hosts: without it
 * mermaid draws its own error diagram into a temporary element and then leaves that element in the
 * document as it rethrows, which on the page is an orphan SVG under nobody's mount.
 */
export function mermaidDiagramConfig(scheme: ThemeScheme, colors: ThemeColors) {
  return {
    startOnLoad: false,
    // Mermaid's own built-in theme (distinct from ours): picks its derived node/edge
    // shading before `themeVariables` below overrides the handful of colours it reads.
    theme: scheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    darkMode: scheme === 'dark',
    suppressErrorRendering: true,
    themeVariables: {
      background: colors.bgRaised,
      primaryColor: colors.bgPanel,
      primaryTextColor: colors.text,
      lineColor: colors.textSecondary,
      textColor: colors.text
    }
  } as const
}

export type MermaidDiagramConfig = ReturnType<typeof mermaidDiagramConfig>
