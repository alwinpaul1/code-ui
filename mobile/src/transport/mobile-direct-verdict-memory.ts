import { directDeadOnNetwork, withDirectVerdict } from './mobile-direct-verdict'
import type { HostProfile } from './types'

type DirectVerdictMemoryDependencies = {
  now: () => number
  saveHost: (host: HostProfile) => Promise<void>
  networkIdentity?: () => Promise<string | null>
}

/**
 * What the phone has proven about a host's direct path, and WHERE. The host
 * profile persists the verdict; this scopes it to the network it was reached
 * on, so a dead LAN behind a VPN stays un-dialled until the network changes
 * instead of costing two 10 s connect timeouts every minute.
 */
export class DirectVerdictMemory {
  constructor(
    private readonly deps: DirectVerdictMemoryDependencies,
    private readonly host: () => HostProfile,
    private readonly setHost: (next: HostProfile) => void
  ) {}

  remember(reachable: boolean): void {
    const apply = (network: string | null): void => {
      const next = withDirectVerdict(this.host(), reachable, this.deps.now(), network)
      if (next) {
        this.setHost(next)
        void this.deps.saveHost(next).catch(() => undefined)
      }
    }
    if (reachable || !this.deps.networkIdentity) {
      apply(null)
      return
    }
    void this.deps.networkIdentity().then(apply, () => apply(null))
  }

  /** The network changed under us: whatever was proven was proven elsewhere. */
  forget(): void {
    const current = this.host()
    if (current.directUnreachableSince == null) {
      return
    }
    const next: HostProfile = { ...current }
    delete next.directUnreachableSince
    delete next.directUnreachableNetwork
    this.setHost(next)
    void this.deps.saveHost(next).catch(() => undefined)
  }

  /** Resolves true when direct was proven dead on the network the phone is on now. */
  async deadHere(): Promise<boolean> {
    if (!this.deps.networkIdentity) {
      return false
    }
    const identity = await this.deps.networkIdentity().catch(() => null)
    return directDeadOnNetwork(this.host(), identity, this.deps.now?.() ?? Date.now())
  }
}
