import { useRef } from 'react'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/** The same array back while nothing in it changed. The echo hooks build a
 *  fresh array every render, and that array is a dependency of the fold
 *  over the whole transcript and of the list's data, so every 1 Hz screen
 *  poll refolded everything and rebuilt the list (2026-09-13). */
export function useStableEchoes(
  echoes: MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  const cache = useRef<{ signature: string; value: MobileNativeChatPendingMessage[] } | null>(null)
  const signature = JSON.stringify(echoes)
  if (cache.current?.signature !== signature) {
    cache.current = { signature, value: echoes }
  }
  return cache.current.value
}
