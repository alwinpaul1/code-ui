/**
 * "The phone's Anthropic sign-ins changed": an account signed in, signed out, or two entries
 * became one. Kept apart from the accounts store so a listener (the sessions path, which matches
 * open tabs to their Remote Control sessions) does not load the secure store to hear it.
 *
 * Not fired for a token refresh: that changes no account, and it happens on the hot path.
 */

const listeners = new Set<() => void>()

export function subscribeAnthropicAccountsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyAnthropicAccountsChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(`[anthropic-accounts] a listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
