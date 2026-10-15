import { useEffect, useState } from 'react'
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network'

/**
 * Whether the phone itself has no network, for a matched Claude tab's status line: the Claude app
 * says "You’re offline. The rest of Claude’s reply will appear when you reconnect."
 * (`chat_footer_polling_offline`, 1.261013.20 zr8.java:1097-1099) while a turn runs with the phone
 * offline (native-chat-connection-notice.ts).
 *
 * Fail-open: only the OS saying `isConnected: false` reads offline. A reading that fails, a null
 * field or a listener that cannot be added reads online, so a broken reading never draws the
 * offline sentence over a chat that works.
 */
export function usePhoneOffline(enabled: boolean): boolean {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setOffline(false)
      return
    }
    let disposed = false
    let heard = false
    const take = (state: Pick<NetworkState, 'isConnected'> | null | undefined) => setOffline(state?.isConnected === false)
    let subscription: { remove: () => void } | null = null
    try {
      subscription = addNetworkStateListener((state) => {
        heard = true
        if (!disposed) {
          take(state)
        }
      })
    } catch {
      subscription = null
    }
    // The first reading seeds the state; a change heard before it lands is newer and wins.
    void getNetworkStateAsync()
      .then((state) => {
        if (!disposed && !heard) {
          take(state)
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      subscription?.remove()
    }
  }, [enabled])
  return enabled && offline
}
