import AsyncStorage from '@react-native-async-storage/async-storage'

/** The two Codex model lists a phone learns per host+worktree: the rows of
 *  Codex's own `/model` picker and the host probe (labels, effort levels).
 *  Both are read live on every open, but that takes seconds over the terminal,
 *  so the last known copy is kept here and shown at once on a cold start. */
const PREFIX = 'orca:codexModels:'

function storageKey(kind: string, key: string): string {
  return `${PREFIX}${kind}:${encodeURIComponent(key)}`
}

export async function readCodexModelList<T>(
  kind: 'visible' | 'discovered',
  key: string,
  isEntry: (value: unknown) => value is T
): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(kind, key))
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isEntry) || parsed.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function writeCodexModelList(
  kind: 'visible' | 'discovered',
  key: string,
  models: readonly unknown[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(kind, key), JSON.stringify(models))
  } catch {
    // Best effort: the live read still lands; only the next cold start loses out.
  }
}
