import { useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { observeOwnQueueAbsorption, type OwnQueueAbsorption } from './own-queue-absorption'

const EMPTY: OwnQueueAbsorption = new Map()

/** Watches the agent's queue box for the phone's own sends leaving it, per
 *  chat scope (see own-queue-absorption.ts). Reduced during render from the
 *  props of this render; idempotent for an unchanged reading. */
export function useOwnQueueAbsorption(
  queued: readonly string[],
  own: readonly string[],
  rawMessages: readonly NativeChatMessage[],
  scopeKey: string
): OwnQueueAbsorption {
  const state = useRef<{ scope: string; queued: readonly string[]; absorbed: OwnQueueAbsorption }>({
    scope: scopeKey,
    queued: [],
    absorbed: EMPTY
  })
  if (state.current.scope !== scopeKey) {
    state.current = { scope: scopeKey, queued: [], absorbed: EMPTY }
  }
  if (state.current.queued !== queued) {
    const absorbed = observeOwnQueueAbsorption(
      state.current.absorbed,
      state.current.queued,
      queued,
      own,
      rawMessages.at(-1)?.id ?? null
    )
    state.current = { scope: scopeKey, queued, absorbed }
  }
  return state.current.absorbed
}
