import { directDeadOnNetwork } from './mobile-direct-verdict'
import { openAuthenticatedDirectEndpoint } from './mobile-direct-endpoint-probe'
import {
  directEndpointUrls,
  directEndpointsPlausibleOnNetwork
} from './mobile-direct-endpoint-list'
import type { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import type { RpcClient } from './rpc-client'
import type { HostProfile } from './types'
import type { MobileConnectionPath } from './stable-logical-rpc-client'

const DIRECT_PROBE_INTERVAL_MS = 15_000
// Why longer: with no plausible address on this network there is nothing to
// learn until the network changes, and a change nudges the probe anyway.
const NO_PLAUSIBLE_ENDPOINT_RECHECK_MS = 60_000

// While the runtime channel rides the relay, periodically probe the direct
// endpoint and migrate back once hysteresis proves it stable.
export class DirectReturnProbe {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: AbortController | null = null
  // Why a latch and not just an abort: stop() must also fence work already past
  // its await, or a probe that authenticated a millisecond earlier still
  // migrates the connection its owner has just given up (upstream #18940).
  private stopped = false

  constructor(
    private readonly deps: {
      now: () => number
      setTimer: typeof setTimeout
      clearTimer: typeof clearTimeout
      openDirect: (endpoint: string) => RpcClient
      /** expo-network's `NetworkStateType` name, or null when unknown. */
      networkType?: () => Promise<string | null>
      /** See readMobileNetworkIdentity; gates re-dialling a path proven dead here. */
      networkIdentity?: () => Promise<string | null>
    },
    private readonly hooks: {
      hysteresis: MobileEndpointHysteresis
      host: () => HostProfile
      canSchedule: () => boolean
      canAttempt: () => boolean
      beginOperation: () => void
      migrate: (
        client: RpcClient,
        path: MobileConnectionPath,
        shouldAbort: () => boolean
      ) => Promise<void>
      onDirectMigrated: () => Promise<void>
      /** A probe timed out or was refused (not aborted). */
      onDirectUnreachable?: () => void
      afterProbe: () => void
    }
  ) {}

  schedule(delayMs = DIRECT_PROBE_INTERVAL_MS): void {
    if (this.stopped || !this.hooks.canSchedule() || this.timer) {
      return
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null
      void this.probe()
    }, delayMs)
  }

  clear(): void {
    if (this.timer) {
      this.deps.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** Give up an in-flight probe so its mutex is released now; a no-op otherwise. */
  abort(): void {
    this.inFlight?.abort()
  }

  /** The owner is gone for good: cancel the probe and never schedule another. */
  stop(): void {
    this.stopped = true
    this.clear()
    this.inFlight?.abort()
  }

  private async deadOnThisNetwork(): Promise<boolean> {
    if (!this.deps.networkIdentity) {
      return false
    }
    const identity = await this.deps.networkIdentity().catch(() => null)
    return directDeadOnNetwork(this.hooks.host(), identity)
  }

  private async plausibleEndpoints(): Promise<string[]> {
    const all = directEndpointUrls(this.hooks.host())
    if (!this.deps.networkType) {
      return all
    }
    const type = await this.deps.networkType().catch(() => null)
    return directEndpointsPlausibleOnNetwork(all, type)
  }

  private async probe(): Promise<void> {
    if (this.stopped) {
      return
    }
    if (!this.hooks.canAttempt() || !this.hooks.hysteresis.canProbe(this.deps.now())) {
      this.schedule()
      return
    }
    // Measured on a Galaxy S23 behind a full-tunnel VPN: both direct endpoints
    // re-dialled every cooldown and every foreground return, two sockets held
    // for the OS's 10 s connect timeout, every minute, all night, on a network
    // that had not changed. A verdict reached HERE stands until the network
    // changes; the nudge router forgets it on 'network-change'.
    if (await this.deadOnThisNetwork()) {
      this.schedule(NO_PLAUSIBLE_ENDPOINT_RECHECK_MS)
      return
    }
    const endpoints = await this.plausibleEndpoints()
    if (endpoints.length === 0) {
      // Why no failure record: nothing was dialed, so nothing was proven. On a
      // Galaxy S23 on cellular the old behaviour re-dialled the LAN address
      // every cycle and each socket hung the whole 12 s connect timeout.
      this.schedule(NO_PLAUSIBLE_ENDPOINT_RECHECK_MS)
      return
    }
    if (!this.hooks.canAttempt()) {
      this.schedule()
      return
    }
    this.hooks.beginOperation()
    const controller = new AbortController()
    this.inFlight = controller
    let successful: Awaited<ReturnType<typeof openAuthenticatedDirectEndpoint>> = null
    try {
      successful = await openAuthenticatedDirectEndpoint(
        this.hooks.host(),
        this.deps.openDirect,
        12_000,
        controller.signal,
        endpoints
      )
      if (this.stopped) {
        return
      }
      if (!successful) {
        // Why: an aborted probe proved nothing about the endpoint.
        if (!controller.signal.aborted) {
          this.hooks.hysteresis.recordDirectFailure(this.deps.now())
          this.hooks.onDirectUnreachable?.()
        }
        return
      }
      if (!this.hooks.hysteresis.recordDirectSuccess(this.deps.now())) {
        successful.client.close()
        return
      }
      const candidate = successful
      // migrate owns the candidate from here, including closing it when the
      // cutover is fenced off.
      successful = null
      try {
        await this.hooks.migrate(candidate.client, candidate.path, () => this.stopped)
      } catch (error) {
        // Why swallow: the fence above makes a superseded cutover throw, and
        // this probe is started with `void probe()`, so anything that escapes
        // becomes an unhandled rejection. migrate owns the candidate socket
        // and has already closed it. A live failure is not silent either — the
        // supervisor sees the path never changed and probes again.
        void error
        return
      }
      if (this.stopped) {
        return
      }
      this.hooks.hysteresis.recordMigration(this.deps.now())
      await this.hooks.onDirectMigrated()
    } finally {
      this.inFlight = null
      successful?.client.close()
      // Why: a relay drop or backoff timer can arrive while the probe owns the
      // operation mutex; afterProbe releases it and replays deferred recovery.
      this.hooks.afterProbe()
      this.schedule()
    }
  }
}
