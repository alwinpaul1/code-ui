import { isTerminalPhoneDisplayMode } from './mobile-session-route-helpers'

/**
 * The shape the terminal bar draws: which display mode its mode key reports,
 * and whether it shows the live field or the buffered command box.
 *
 * Before the host names the active tab's PTY (the cached tab strip paints
 * first), there is no terminal to describe. Drawing "no terminal" as desktop
 * mode and the buffered box made the bar flip to phone mode and the live
 * field a moment later (0.9.132, 2026-10-13: "Opens in desktop and flashes
 * and changes to mobile"). So it draws the shape a tab opens in: display mode
 * 'auto' (phone) until the host says otherwise, and live input, which every
 * terminal defaults to. A pane the user set to buffered input still flips
 * once its handle lands; that choice is stored per handle and is not known
 * before then.
 */
export function resolveTerminalDockPresentation(args: {
  activeHandle: string | null
  liveInputEnabled: boolean
  terminalModes: ReadonlyMap<string, 'auto' | 'phone' | 'desktop'>
}): { phoneMode: boolean; liveBar: boolean } {
  if (!args.activeHandle) {
    return { phoneMode: true, liveBar: true }
  }
  return {
    phoneMode: isTerminalPhoneDisplayMode(args.activeHandle, args.terminalModes),
    liveBar: args.liveInputEnabled
  }
}
