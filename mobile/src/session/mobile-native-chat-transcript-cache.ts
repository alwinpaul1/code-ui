import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  EMPTY_NATIVE_CHAT_TRANSCRIPT,
  type NativeChatTranscriptRetention
} from '../../../src/shared/native-chat-transcript-retention'

// Why a process-wide cache: the chat hook is torn down every time the user
// leaves a project, so returning showed a spinner until the host re-sent the
// transcript — the second half of the "loads twice" feel when switching
// projects. Keeping the last settled transcript per identity lets the
// conversation paint at once while the fresh subscription catches up.

const MAX_IDENTITIES = 12

const captured = new Map<string, NativeChatMessage[]>()

function remember(identity: string, messages: NativeChatMessage[]): void {
  captured.delete(identity)
  captured.set(identity, messages)
  while (captured.size > MAX_IDENTITIES) {
    const oldest = captured.keys().next().value
    if (oldest === undefined) {
      break
    }
    captured.delete(oldest)
  }
}

/** Same contract as the per-hook retention, backed by the shared cache. */
export const sharedNativeChatTranscriptRetention: NativeChatTranscriptRetention = {
  capture(identity, messages) {
    remember(identity, messages)
  },
  retained(identity) {
    return captured.get(identity) ?? null
  },
  visible({ identity, messages, settled }) {
    if (settled) {
      return messages
    }
    return captured.get(identity) ?? EMPTY_NATIVE_CHAT_TRANSCRIPT
  }
}

export function resetNativeChatTranscriptCacheForTests(): void {
  captured.clear()
}
