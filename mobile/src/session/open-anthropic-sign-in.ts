/** Where the in-app Anthropic sign-in lives (app/anthropic-sign-in.tsx, AnthropicSignInScreen.tsx). */
export const ANTHROPIC_SIGN_IN_ROUTE = '/anthropic-sign-in'

/** Opens the in-app Anthropic sign-in, from the Anthropic accounts screen. expo-router is loaded
 *  with import(): it has no Node entry, and that screen's tests would fail to import it
 *  (open-anthropic-accounts.ts). */
export function openAnthropicSignIn(): void {
  void import('expo-router').then(
    ({ router }) => router.push(ANTHROPIC_SIGN_IN_ROUTE),
    (error: unknown) => console.warn(`[anthropic-sign-in] could not open the sign-in: ${error instanceof Error ? error.message : String(error)}`)
  )
}
