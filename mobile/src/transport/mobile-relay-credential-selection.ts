import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import type { RelayRecoveryLog } from './mobile-relay-recovery-log'
import type { ForegroundNudgeReason } from './types'

// Why: pairing recovery, re-pairing, or a raced rotation can land a fresh
// durable bundle after the supervisor snapshotted its copy; a gated retry must
// see it instead of dialing (or refusing to dial) on stale state forever.
//
// Adoption is decided by OUTCOME, not by version: renewals extend expiresAt
// without bumping current.version, and a re-pair restarts the version counter,
// so version comparison cannot tell fresh from stale. The durable bundle is
// adopted exactly when it yields a dialable (unexpired, non-rejected)
// credential while the in-memory one does not — which also means a revoked
// version can never be resurrected from a stale disk copy.
export type RelayCredentialSelection = {
  bundle: MobileRelayCredentialBundle | null
  credentials: MobileRelayCredentialBundle['current'][]
  /** Set when the durable store could not be read. Swallowing it made a
   *  Keystore failure log as "expired or rejected" (Pixel, 2026-09-27). */
  diskReadError?: Error
}

export async function selectDialableRelayCredentials(args: {
  bundle: MobileRelayCredentialBundle | null
  controller: RelayReconnectController
  readBundle: () => Promise<MobileRelayCredentialBundle | null>
  onAdoptedFresherBundle: () => void
}): Promise<RelayCredentialSelection> {
  const memory = args.bundle
  const memoryCredentials = memory
    ? args.controller.eligibleCredentials(memory.current, memory.grace)
    : []
  if (memoryCredentials.length > 0) {
    // Why: in-memory can be newer than disk (a resume confirmation whose
    // durable write failed); never let a stale disk copy shadow it.
    return { bundle: memory, credentials: memoryCredentials }
  }
  let disk: MobileRelayCredentialBundle | null = null
  let diskReadError: Error | undefined
  try {
    disk = await args.readBundle()
  } catch (error) {
    diskReadError = error instanceof Error ? error : new Error(String(error))
  }
  if (disk) {
    const diskCredentials = args.controller.eligibleCredentials(disk.current, disk.grace)
    if (diskCredentials.length > 0) {
      args.controller.acceptFreshCredential(disk.current.version)
      args.onAdoptedFresherBundle()
      return { bundle: disk, credentials: diskCredentials }
    }
  }
  return {
    bundle: memory ?? disk,
    credentials: [],
    ...(diskReadError ? { diskReadError } : {})
  }
}

/**
 * An app resume or a Send under the fresh-credential gate. The gate re-reads
 * the durable bundle only on its slow tick, up to 15 min away, so a resume
 * over a good credential another client or a re-pair had already written sat
 * out the whole tick. Adopts a durable credential that is not the one held
 * (the relay refused that one, whether or not its version was recorded) and
 * that the relay has not refused, lifting the gate and the cooldown booked
 * against the refused one (a manual retry skips the cooldown anyway). Returns
 * the adopted bundle, or null, and reads nothing for any other nudge or with
 * no gate held. Never rejects: a read failure is left to the gated reprobe,
 * which logs it with its error.
 */
export async function adoptDurableCredentialForManualRetry(
  reason: ForegroundNudgeReason,
  controller: RelayReconnectController,
  log: RelayRecoveryLog,
  args: {
    held: MobileRelayCredentialBundle | null
    readBundle: () => Promise<MobileRelayCredentialBundle | null>
    isActive: () => boolean
  }
): Promise<MobileRelayCredentialBundle | null> {
  const manualRetry = reason === 'app-resume' || reason === 'user-send'
  if (!manualRetry || !controller.blocksUntilFreshCredential()) {
    return null
  }
  const disk = await args.readBundle().catch(() => null)
  if (
    !disk ||
    !args.isActive() ||
    disk.current.hash === args.held?.current.hash ||
    !controller.blocksUntilFreshCredential() ||
    !controller.hasDialableCredential(disk.current, disk.grace)
  ) {
    return null
  }
  controller.acceptFreshCredential(disk.current.version)
  if (controller.blocksUntilFreshCredential()) {
    return null
  }
  controller.reset()
  const detail = `version ${disk.current.version}, on a manual retry`
  log('adopted fresher durable credential bundle', detail)
  return disk
}
