import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'

/**
 * Whether anyone is signed in to Anthropic on this phone, for a Claude tab's chat: it reads only
 * from Anthropic, so with nobody signed in it shows a sign-in line instead (the user, 2026-10-15:
 * "the user needs to be signed in to Code UI").
 *
 * `null` until the store has been read once. Read again on every sign-in or sign-out
 * (anthropic-accounts-events.ts). The accounts store is loaded with import(): it pulls the secure
 * store in, which the chat's controller and its tests must not load (as ccr-session-default-deps).
 */

type Reader = () => Promise<number>

const defaultReader: Reader = async () => {
  const [{ listAccounts }, { isAccountUsable }] = await Promise.all([import('../dictation/anthropic-accounts-store'), import('../dictation/anthropic-account-state')])
  return (await listAccounts()).filter((account) => isAccountUsable(account)).length
}

let reader: Reader = defaultReader
let usable: number | null = null
let reading: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()

function publish(count: number | null): void {
  if (count === usable) {
    return
  }
  usable = count
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** Reads the store (again). Never rejects: an unreadable store counts as nobody signed in, and says so once. */
export function refreshAnthropicSignInPresence(): Promise<void> {
  reading ??= reader()
    .then(
      (count) => publish(count),
      (error: unknown) => {
        console.warn(`[anthropic-sign-in] the accounts could not be read: ${error instanceof Error ? error.message : String(error)}`)
        publish(0)
      }
    )
    .finally(() => {
      reading = null
    })
  return reading
}

export function anthropicSignedInCount(): number | null {
  return usable
}

export function anthropicSignInPresenceVersion(): number {
  return version
}

export function subscribeAnthropicSignInPresence(listener: () => void): () => void {
  listeners.add(listener)
  if (usable === null) {
    void refreshAnthropicSignInPresence()
  }
  return () => {
    listeners.delete(listener)
  }
}

subscribeAnthropicAccountsChanged(() => {
  void refreshAnthropicSignInPresence()
})

export function setAnthropicSignInReaderForTests(next: Reader | null): void {
  reader = next ?? defaultReader
  usable = null
  reading = null
  version += 1
}
