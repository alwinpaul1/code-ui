/**
 * "The phone's Anthropic sign-ins changed": an account signed in, signed out, or two entries
 * became one. Kept apart from the accounts store so a listener (the sessions path, which matches
 * open tabs to their Remote Control sessions) does not load the secure store to hear it.
 *
 * Not fired for a token refresh: that changes no account, and it happens on the hot path.
 */

/** What changed. `signedOut`: the account that signed out, or every account. `removed`: entries
 *  gone though nobody signed out (merged into the account they turned out to be, or replaced by a
 *  new sign-in); what the phone keeps under those ids is as dead as a signed-out account's. */
export type AnthropicAccountsChange = { signedOut?: string | 'all'; removed?: readonly string[] }

const listeners = new Set<(change: AnthropicAccountsChange) => void>()

export function subscribeAnthropicAccountsChanged(listener: (change: AnthropicAccountsChange) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyAnthropicAccountsChanged(change: AnthropicAccountsChange = {}): void {
  for (const listener of listeners) {
    try {
      listener(change)
    } catch (error) {
      console.warn(`[anthropic-accounts] a listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
