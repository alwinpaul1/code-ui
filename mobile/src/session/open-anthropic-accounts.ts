/**
 * Where the phone's Anthropic sign-in lives. One place, so a move of the screen is one line here
 * (2026-10-15: the sign-in is moving out of Voice settings to its own screen under Settings).
 */
export const ANTHROPIC_ACCOUNTS_ROUTE = '/voice-settings'

/** Opens the Anthropic accounts screen. expo-router is loaded with import(): it has no Node
 *  entry, and every test that draws the chat overlay would fail to import it. */
export function openAnthropicAccounts(): void {
  void import('expo-router').then(
    ({ router }) => router.push(ANTHROPIC_ACCOUNTS_ROUTE),
    (error: unknown) => console.warn(`[anthropic-accounts] could not open the sign-in: ${error instanceof Error ? error.message : String(error)}`)
  )
}
