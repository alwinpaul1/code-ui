import { useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { rememberScreenSentPhotos, withScreenSentPhotos } from './mobile-native-chat-sent-photos'
import type { ScreenSentPhotos } from './mobile-terminal-sent-photos'

const NONE: ReadonlyMap<string, number> = new Map()

/**
 * The chat with a "Photo" chip on each message the agent's screen showed
 * photos for. Remembered per stream scope, which carries the session id, so a
 * chip outlives the message scrolling off Claude's screen and never follows
 * a `/clear` into the next conversation.
 */
export function useScreenSentPhotos(
  readings: readonly ScreenSentPhotos[],
  folded: readonly NativeChatMessage[],
  scopeKey: string | null
): NativeChatMessage[] {
  const memory = useRef<{ scopeKey: string | null; known: ReadonlyMap<string, number> }>({ scopeKey, known: NONE })
  if (memory.current.scopeKey !== scopeKey) {
    memory.current = { scopeKey, known: NONE }
  }
  memory.current = { scopeKey, known: rememberScreenSentPhotos(memory.current.known, folded, readings) }
  const known = memory.current.known
  return useMemo(() => withScreenSentPhotos(folded, known), [folded, known])
}
