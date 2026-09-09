/** Title the HUD reader gives its throwaway host terminals. */
export const AGENT_HUD_TERMINAL_TITLE = 'Code UI HUD'

/**
 * The HUD reader opens a host terminal for ~1 s per agent tab every 30 s and
 * the desktop still hands it a tab, so the strip showed "Terminal" pills
 * flashing in and out (Galaxy S23, 2026-09-09). Those are bookkeeping, not the
 * user's terminals; drop them before the strip ever sees them.
 */
export function hideAgentHudTabs<Tab extends { type: string; title?: string | null }>(
  tabs: readonly Tab[]
): Tab[] {
  const kept = tabs.filter(
    (tab) => !(tab.type === 'terminal' && tab.title === AGENT_HUD_TERMINAL_TITLE)
  )
  return kept.length === tabs.length ? [...tabs] : kept
}
