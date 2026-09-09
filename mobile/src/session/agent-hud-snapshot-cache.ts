import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  parseAgentHudSnapshot,
  type AgentHudSnapshot,
  type AgentHudSnapshotTarget
} from './agent-hud-snapshot'

/** The last snapshot the agent gave for a session, so the HUD paints at once.
 *
 *  A fresh snapshot is a shell round trip on the host: status.get, then
 *  terminal.create, terminal.wait, resolveTerminalPath, readTerminalArtifact,
 *  plus node starting — about a second over the relay, measured on a Galaxy S23
 *  on 2026-09-09 as the model and context pills appearing a second after the
 *  tab did. The numbers are the agent's own record for THIS session (the key is
 *  the transcript path or the Codex session id, never a cwd, which two sessions
 *  can share), and the HUD already tolerates them being up to 30 s old by
 *  design, so showing the last known ones while the fresh read lands is the
 *  same promise it always made. */
const STORAGE_PREFIX = 'orca.mobile.agent-hud.v1.'
const INDEX_KEY = `${STORAGE_PREFIX}index`
// Bounded: sessions are never "closed" from the phone's point of view.
const MAX_PERSISTED = 32

const memory = new Map<string, AgentHudSnapshot>()
const hydrations = new Map<string, Promise<AgentHudSnapshot | null>>()
let indexWrite: Promise<void> = Promise.resolve()

export function agentHudCacheKey(target: AgentHudSnapshotTarget): string | null {
  if (target.agent === 'claude') {
    return target.transcriptPath ? `claude:${target.transcriptPath}` : null
  }
  return target.sessionId ? `codex:${target.sessionId}` : null
}

/** Synchronous, for a first render. */
export function peekAgentHudSnapshot(key: string | null): AgentHudSnapshot | null {
  return key ? (memory.get(key) ?? null) : null
}

export function rememberAgentHudSnapshot(key: string | null, snapshot: AgentHudSnapshot): void {
  if (!key || snapshot.error) {
    return
  }
  memory.set(key, snapshot)
  void AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(snapshot)).catch(() => undefined)
  indexWrite = indexWrite
    .then(async () => {
      const index = await readIndex()
      const next = [key, ...index.filter((entry) => entry !== key)]
      const evicted = next.splice(MAX_PERSISTED)
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next))
      for (const stale of evicted) {
        memory.delete(stale)
        await AsyncStorage.removeItem(STORAGE_PREFIX + stale)
      }
    })
    .catch(() => undefined)
}

/** From storage, for a session last seen before this app launch. Resolves null
 *  when nothing was stored or what was stored no longer parses. */
export function hydrateAgentHudSnapshot(key: string | null): Promise<AgentHudSnapshot | null> {
  if (!key) {
    return Promise.resolve(null)
  }
  const cached = memory.get(key)
  if (cached) {
    return Promise.resolve(cached)
  }
  let pending = hydrations.get(key)
  if (!pending) {
    pending = AsyncStorage.getItem(STORAGE_PREFIX + key)
      .then((raw) => {
        // Re-run the same validator a live read goes through; a stored shape
        // from an older build must degrade, not be trusted.
        const parsed = raw ? parseAgentHudSnapshot(raw) : null
        if (parsed && !parsed.error && !memory.has(key)) {
          memory.set(key, parsed)
        }
        return memory.get(key) ?? null
      })
      .catch(() => null)
      .finally(() => hydrations.delete(key))
    hydrations.set(key, pending)
  }
  return pending
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function resetAgentHudSnapshotCacheForTests(): void {
  memory.clear()
  hydrations.clear()
  indexWrite = Promise.resolve()
}
