import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'

const SESSION_OPTION_RECORD_PREFIX = 'orca:sessionOptions:'

function sessionOptionRecordKey(scopeKey: string): string {
  return `${SESSION_OPTION_RECORD_PREFIX}${encodeURIComponent(scopeKey)}`
}

function isRecord(value: unknown): value is NativeChatSessionOptionRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<NativeChatSessionOptionRecord>
  return (
    typeof candidate.agent === 'string' &&
    candidate.valuesByModel !== null &&
    typeof candidate.valuesByModel === 'object'
  )
}

/**
 * The model / effort / fast-mode picks made in Chat UI, per host+worktree+tab.
 *
 * Why persist: the agent's hook reports the model back, but nothing ever reports
 * effort or a toggle, so those live only in the phone's memory. Android reclaims
 * that memory freely while the user is in another worktree or app, and the
 * pickers then reopened showing the catalog default even though the agent was
 * still running with the picked values.
 */
export async function readSessionOptionRecord(
  scopeKey: string
): Promise<NativeChatSessionOptionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionOptionRecordKey(scopeKey))
    if (raw === null) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeBarriers = new Map<string, Promise<void>>()

/** Serialized per scope so a slow older write cannot land over a newer pick. */
export function writeSessionOptionRecord(
  scopeKey: string,
  record: NativeChatSessionOptionRecord
): Promise<void> {
  const key = sessionOptionRecordKey(scopeKey)
  const payload = JSON.stringify(record)
  const write = (writeBarriers.get(scopeKey) ?? Promise.resolve()).then(() =>
    AsyncStorage.setItem(key, payload)
  )
  const barrier = write.catch(() => undefined)
  writeBarriers.set(scopeKey, barrier)
  void barrier.then(() => {
    if (writeBarriers.get(scopeKey) === barrier) {
      writeBarriers.delete(scopeKey)
    }
  })
  return write
}
