import { vi } from 'vitest'
import { bundle, dependencies, FakeSession, host, relay } from './mobile-endpoint-supervisor-test-fakes'
import { MobileEndpointSupervisor } from './mobile-endpoint-supervisor'
import { connectMobileRelayRpcSession } from './mobile-relay-rpc-session'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import { createStableLogicalRpcClient, type StableLogicalRpcClient } from './stable-logical-rpc-client'
import { answerLikeDesktop, fakeRelayLinks, type FakeRelayLink } from './relay-desktop-fake-link'
import type { ConnectionState } from './types'

// A phone that reaches its desktop only through the relay, as the S23 does at
// home: the Mac's full-tunnel VPN owns the LAN route, so the direct socket never
// opens. Everything above the cell socket is the real code — the relay RPC
// session, the stable logical client, and the endpoint supervisor with its
// backoff and migration. The cell socket is FakeRelayLink; see
// relay-desktop-fake-link.ts for the vi.mock a suite needs.

export type RelayOnlyPhone = {
  logical: StableLogicalRpcClient
  supervisor: MobileEndpointSupervisor
  /** Resolves when the supervisor's first relay dial has migrated in. */
  started: Promise<void>
  /** The resume-confirmation request id the supervisor minted for each dial. */
  confirmReqIds: string[]
  states: ConnectionState[]
}

export function openRelayOnlyPhone(): RelayOnlyPhone {
  const confirmReqIds: string[] = []
  const states: ConnectionState[] = []
  // The direct client host-logical-client.ts opens first, dead behind the VPN.
  const logical = createStableLogicalRpcClient(new FakeSession('disconnected'), 'lan')
  logical.onStateChange((state) => states.push(state))
  const supervisor = new MobileEndpointSupervisor(
    logical,
    host,
    dependencies({
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      openRelay: (endpoint, credential, confirmReqId, onHostCloseReason) => {
        confirmReqIds.push(confirmReqId)
        return connectMobileRelayRpcSession({
          relay: endpoint,
          resumeToken: credential.token,
          resumeCredentialVersion: credential.version,
          resumeConfirmReqId: confirmReqId,
          deviceToken: host.deviceToken,
          desktopPublicKeyB64: host.publicKeyB64,
          ...(onHostCloseReason ? { onHostCloseReason } : {})
        })
      },
      // Full jitter at one half: the first transport retry lands at 250 ms.
      randomBytes: (length) => new Uint8Array(length).fill(128)
    })
  )
  return { logical, supervisor, started: supervisor.start(), confirmReqIds, states }
}

/** The cell closes the phone's socket on `link` with close code `code`. */
export function dropRelayLink(link: FakeRelayLink, code: number): void {
  link.fail(new RelayOuterError(code))
}

/** The cell and the desktop accept the dial on `link`: hello, then the resume
 *  confirmation and capability replies the session waits for. */
async function authenticateRelayLink(link: FakeRelayLink, confirmReqId: string): Promise<void> {
  const version = bundle.current.version
  const resumeExpiresAt = Date.now() + 30 * 24 * 3_600_000
  link.options.onHello?.({
    type: 'relay-hello',
    ok: true,
    credentialKind: 'resume',
    // Far enough out that no lease rotation fires inside a test.
    leaseExpiresAt: Date.now() + 3_600_000,
    acceptedCredentialVersion: version,
    acceptedAs: 'current',
    resumeExpiresAt
  })
  link.options.onAuthenticated()
  await vi.waitFor(() => {
    if (link.frames.length < 2) {
      throw new Error('waiting for the resume confirmation and capability requests')
    }
  })
  const [confirmation, capabilities] = link.frames
  link.reply(confirmation!.id, {
    v: 1,
    relay,
    resumeConfirmation: {
      v: 1,
      reqId: confirmReqId,
      currentVersion: version,
      acceptedAs: 'current',
      renewed: true,
      resumeExpiresAt
    }
  })
  link.reply(capabilities!.id, {})
  link.answer = answerLikeDesktop
}

/** The supervisor's `index`th relay dial, once it has opened its socket. */
export async function relayDial(index: number): Promise<FakeRelayLink> {
  await vi.waitFor(() => {
    if (fakeRelayLinks.length <= index) {
      throw new Error(`waiting for relay dial ${index + 1}`)
    }
  })
  return fakeRelayLinks[index]!
}

/** Waits for the supervisor to open its `index`th cell socket, then lets it in. */
export async function acceptRelayDial(phone: RelayOnlyPhone, index: number): Promise<FakeRelayLink> {
  const link = await relayDial(index)
  await authenticateRelayLink(link, phone.confirmReqIds[index]!)
  await vi.waitFor(() => {
    if (phone.logical.getState() !== 'connected') {
      throw new Error('waiting for the migration to publish connected')
    }
  })
  return link
}
