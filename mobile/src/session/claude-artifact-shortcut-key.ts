import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

// ─── The key Code UI's own artifact shortcuts carry ──────────────────────────
//
// `codeui://` and `orca://` are exported schemes, so any installed app can fire
// `codeui://artifact?url=…` (review 2026-10-16). Every app-scheme link to the
// viewer is therefore marked as from outside (claude-artifact-native-intent.ts)
// and asks "Open this artifact?" first. The one exception is a home-screen
// shortcut Code UI pinned itself, which opens at once as the Claude app's does:
// it carries this key as `k`, made once per install and kept in the keystore.
// Another app cannot read a pinned shortcut's intent (only the launcher can), so
// it cannot learn the key. Anything that goes wrong here makes the route ask.

const STORE_KEY = 'codeui-artifact-shortcut-key'
const KEY_BYTES = 16

let held: string | null = null

function warn(what: string, error: unknown): void {
  console.warn(`[artifacts] the shortcut key could not be ${what}: ${error instanceof Error ? error.message : String(error)}`)
}

/** The install's key, made and kept on first use; null when it cannot be kept. */
export async function artifactShortcutKey(): Promise<string | null> {
  if (held !== null) {
    return held
  }
  try {
    const stored = await SecureStore.getItemAsync(STORE_KEY)
    if (stored) {
      held = stored
      return held
    }
    const made = Array.from(Crypto.getRandomBytes(KEY_BYTES), (byte) => byte.toString(16).padStart(2, '0')).join('')
    await SecureStore.setItemAsync(STORE_KEY, made)
    held = made
    return held
  } catch (error) {
    warn('kept', error)
    return null
  }
}

/** Whether `k` is this install's key. Never makes a key to compare against. */
export async function isArtifactShortcutKey(k: string | undefined): Promise<boolean> {
  if (!k) {
    return false
  }
  try {
    const stored = held ?? (await SecureStore.getItemAsync(STORE_KEY))
    return typeof stored === 'string' && stored.length > 0 && stored === k
  } catch (error) {
    warn('read', error)
    return false
  }
}

/** For tests: forget the key held in memory, so the next read goes to the store. */
export function resetArtifactShortcutKeyForTests(): void {
  held = null
}
