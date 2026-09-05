import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  EMPTY_NATIVE_CHAT_TRANSCRIPT,
  type NativeChatTranscriptRetention
} from '../../../src/shared/native-chat-transcript-retention'
import { createPersistedMap } from './session-cache-persistence'

// Why a process-wide, persisted cache: the chat hook is torn down every time
// the user leaves a project, so returning showed a spinner until the host
// re-sent the transcript — the second half of the "loads twice" feel when
// switching projects, and all of it on a cold start. Keeping the last settled
// transcript per identity lets the conversation paint at once while the fresh
// subscription catches up.

/** Enough to fill a phone screen several times over; the host pages the rest. */
const PERSISTED_TAIL = 40

const store = createPersistedMap<NativeChatMessage[]>({
  storageKey: 'codeui:chat-transcript-cache',
  maxEntries: 12,
  trim: (messages) => messages.slice(-PERSISTED_TAIL)
})

/** Same contract as the per-hook retention, backed by the shared cache. */
export const sharedNativeChatTranscriptRetention: NativeChatTranscriptRetention = {
  capture(identity, messages) {
    store.set(identity, messages)
  },
  retained(identity) {
    return store.get(identity) ?? null
  },
  visible({ identity, messages, settled }) {
    if (settled) {
      return messages
    }
    return store.get(identity) ?? EMPTY_NATIVE_CHAT_TRANSCRIPT
  }
}

export function hydrateNativeChatTranscriptCache(): Promise<void> {
  return store.hydrate()
}

export function resetNativeChatTranscriptCacheForTests(): void {
  store.reset()
}
