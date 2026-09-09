import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/accounts-snapshot'
import type { RpcClient } from '../transport/rpc-client'
import { sendSingleFlightRequest } from '../transport/request-single-flight'

type ConnectedHostClient = { hostId: string; client: RpcClient }

/**
 * Pull-to-refresh on Home re-reads account usage and nothing else. It sends
 * one `accounts.list` per host that is already connected and leaves the
 * connection alone: no nudge, no reconnect, no probe. Hosts that are not
 * connected are skipped rather than woken; their usage shows when they are.
 * Resolves when every request has settled, so the spinner has a definite end.
 */
export async function refreshAccountUsage(
  clients: readonly ConnectedHostClient[],
  setSnapshots: (
    update: (previous: Record<string, AccountsSnapshot>) => Record<string, AccountsSnapshot>
  ) => void
): Promise<void> {
  const reads = clients
    .filter(({ client }) => client.getState() === 'connected')
    .map(({ client, hostId }) =>
      sendSingleFlightRequest(client, hostId, 'accounts.list')
        .then((response) => {
          if (response.ok) {
            const snapshot = decodeAccountsSnapshot(response.result)
            setSnapshots((previous) => ({ ...previous, [hostId]: snapshot }))
          }
        })
        .catch(() => {})
    )
  await Promise.all(reads)
}
