import type {
  DeviceCredentialInstalled,
  MobileRelayEndpoint,
  PairingGetEndpointsResult
} from '../../../src/shared/mobile-relay-credential-contract'
import type { PairingRelay } from '../../../src/shared/mobile-relay-pairing-offer'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import type { HostProfile } from './types'

export function relayHost(journal: MobileRelayPairingJournal, relay: MobileRelayEndpoint): HostProfile {
  const host = journal.metadata.host
  const url = new URL(relay.cellUrl)
  url.protocol = 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(relay.relayHostId)}`
  return {
    ...host,
    deviceToken: journal.secrets.deviceToken,
    endpoints: [
      { id: 'direct-primary', kind: 'lan', url: host.endpoint },
      { id: 'relay-primary', kind: 'relay', url: url.toString() }
    ],
    relayHostId: relay.relayHostId,
    relay
  }
}

export function pairingRelay(journal: MobileRelayPairingJournal): PairingRelay {
  return { ...journal.metadata.relay, inviteToken: journal.secrets.inviteToken }
}

export function assertCommitted(
  endpoints: PairingGetEndpointsResult,
  installed: DeviceCredentialInstalled
): void {
  if (
    endpoints.installStatus?.state !== 'committed' ||
    JSON.stringify(endpoints.installStatus.result) !== JSON.stringify(installed)
  ) {
    throw new Error('relay pairing recovery install was not authoritatively committed')
  }
}
