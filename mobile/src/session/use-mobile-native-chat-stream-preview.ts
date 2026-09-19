import { useRef } from 'react'
import { mobileNativeChatStreamPreview } from './mobile-native-chat-streaming-gate'

/** The status text the streaming bubble may draw this render: the host's
 *  `lastAssistantMessage` while the agent works, minus the previous turn's
 *  reply when the status carried it over (a host that never went idle
 *  between the turns does not reset it — device 2026-09-19, "Same response
 *  twice"). The reply seen while idle is remembered for hosts that publish
 *  no `lastCompletedAssistantMessage`. */
export function useMobileNativeChatStreamPreview(
  status: Parameters<typeof mobileNativeChatStreamPreview>[0],
  working: boolean
): string | undefined {
  const settledRef = useRef<string | null>(null)
  if (!working) {
    settledRef.current = status?.lastAssistantMessage ?? null
  }
  return mobileNativeChatStreamPreview(status, working, settledRef.current)
}
