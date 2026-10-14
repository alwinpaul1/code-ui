import { Code, Hand, ScrollText, Zap, type LucideIcon } from 'lucide-react-native'
import type { ThemeColors } from '../theme/tokens'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

/**
 * How the Claude app draws a permission mode (com.anthropic.claude 1.261009.20): the glyph from
 * `ky20.q` (ky20.java:923, a hand, code, a scroll, a lightning bolt) and its tint from `ky20.h`
 * (ky20.java:344-424). The Select mode sheet and the + sheet's Permission row read it from here,
 * so a mode is one glyph in one colour wherever it is shown. The glyphs are a table, not a
 * function, so a caller can pick one and use it as a component without the lint rule that
 * refuses a component made during render (`react/static-components`); `Record` over the whole
 * union keeps a new mode from compiling until it has a glyph.
 *
 * `default` is the observation's fill for "a footer and no mode row", which every surface here
 * already reads as Manual. Bypass has no row in the sheet but the + sheet still names a session
 * started in it, and the app draws it as Auto does.
 */
export const PERMISSION_MODE_ICONS: Record<TerminalPermissionMode, LucideIcon> = {
  default: Hand,
  manual: Hand,
  acceptEdits: Code,
  plan: ScrollText,
  auto: Zap,
  bypassPermissions: Zap
}

/** The mode's glyph colour, from the theme's tokens so each scheme draws its own. */
export function permissionModeTint(colors: ThemeColors, mode: TerminalPermissionMode): string {
  switch (mode) {
    case 'default':
    case 'manual':
      return colors.modeManual
    case 'acceptEdits':
      return colors.modeAcceptEdits
    case 'plan':
      return colors.modePlan
    case 'auto':
    case 'bypassPermissions':
      return colors.modeAuto
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}
