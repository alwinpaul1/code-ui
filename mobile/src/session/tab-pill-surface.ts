import type { ThemeColors } from '../theme/tokens'

/** The tab pill's fill in MobileSessionHeader: the theme's text colour when the tab is selected,
 *  otherwise the panel, raised while a finger is on it. */
export function tabPillBackground(
  colors: Pick<ThemeColors, 'text' | 'bgPanel' | 'bgRaised'>,
  active: boolean,
  pressed: boolean
): string {
  return active ? colors.text : pressed ? colors.bgRaised : colors.bgPanel
}

/** Which of AgentStateDot's tone tables the pill's dot reads. The selected pill inverts the scheme
 *  (light in dark mode, near-black in light mode); an unselected one is the scheme's own panel,
 *  light in light mode, pressed or not. Passing the flags for the selected pill only drew the
 *  desktop's tones on the light unselected pill, as faint as 1.55:1 (2026-10-04). The pressed
 *  state is not an input: both unselected fills of a scheme take the same table. */
export function tabPillDotSurface(
  active: boolean,
  isDark: boolean
): { onLightSurface: boolean; onDarkSurface: boolean } {
  const light = active === isDark
  return { onLightSurface: light, onDarkSurface: !light }
}
