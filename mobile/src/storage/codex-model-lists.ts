import AsyncStorage from '@react-native-async-storage/async-storage'

/** The model lists a phone learns per host+worktree: the rows of Codex's own
 *  `/model` picker, the host probe for Codex (labels, effort levels), and the
 *  host probe for Claude (claude-model-discovery.ts). Reading any of them live
 *  takes seconds, so the last known copy is kept here and shown at once on a
 *  cold start. The prefix predates the Claude list; renaming it would orphan
 *  every Codex list already stored. */
const PREFIX = 'orca:codexModels:'

type ModelListKind = 'visible' | 'discovered' | 'claude-discovered'

function storageKey(kind: string, key: string): string {
  return `${PREFIX}${kind}:${encodeURIComponent(key)}`
}

export async function readCodexModelList<T>(
  kind: ModelListKind,
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
  kind: ModelListKind,
  key: string,
  models: readonly unknown[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(kind, key), JSON.stringify(models))
  } catch {
    // Best effort: the live read still lands; only the next cold start loses out.
  }
}
