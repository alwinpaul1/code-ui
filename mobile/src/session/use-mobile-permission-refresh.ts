import { useEffect } from 'react'
import type { MobileChatPermission } from './mobile-native-chat-permission'

/** Hooks can announce an approval before its terminal overlay has drawn. */
export function useMobilePermissionRefresh(
  permission: MobileChatPermission | null,
  refresh: () => Promise<unknown>
): void {
  const key = permission ? JSON.stringify(permission) : null
  useEffect(() => {
    if (!key) {
      return
    }
    const timers = [0, 400, 1500].map((ms) => setTimeout(() => void refresh(), ms))
    return () => timers.forEach(clearTimeout)
  }, [key, refresh])
}
