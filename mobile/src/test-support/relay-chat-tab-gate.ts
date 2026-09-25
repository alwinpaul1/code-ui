import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileNativeChatInputLease } from '../session/use-mobile-native-chat-input-lease'

/**
 * A terminal chat tab's send gate as the controller builds it (`inputSendable`
 * in use-mobile-native-chat-controller.ts), from a real client: the connection
 * state as useHostClient re-renders it, and the input lease that the host's
 * `subscribed` acknowledgement of the terminal subscription grants. A relay
 * replacement replays that subscription, so the lease comes back one reply
 * after the link does, exactly as on the phone.
 */
export function useRelayChatTabGate(
  client: RpcClient,
  handle: string
): { connState: ConnectionState; leaseReady: boolean; sendable: boolean } {
  const [connState, setConnState] = useState<ConnectionState>(client.getState())
  useEffect(() => client.onStateChange(setConnState), [client])
  const lease = useMobileNativeChatInputLease({
    activeHandle: handle,
    connected: connState === 'connected'
  })
  const { markReady } = lease
  useEffect(
    () =>
      client.subscribe(
        'terminal.subscribe',
        { terminal: handle, client: { id: 'device-token', type: 'mobile' } },
        (event) => {
          if ((event as { type?: unknown } | null)?.type === 'subscribed') {
            markReady(handle)
          }
        }
      ),
    [client, handle, markReady]
  )
  return { connState, leaseReady: lease.ready, sendable: lease.ready && connState === 'connected' }
}
