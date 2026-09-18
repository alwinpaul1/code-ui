import { useEffect, useState } from 'react'
import { getAgentHudBeaconArrivedAt, type AgentHudBeacon } from './agent-hud-beacon'
import {
  beaconWatchVerdict,
  readBeaconWatch,
  stepBeaconWatch,
  writeBeaconWatch,
  type BeaconPhase
} from './agent-hud-beacon-liveness'

/** While a beacon is written off and the agent is working, look this often
 *  for a beacon whose bytes repeat the dead one's exactly — such a repeat is
 *  an arrival the store does not republish, so nothing else would re-run
 *  this. */
const DEAD_RECHECK_MS = 5_000

/**
 * Whether the beacon held for `handle` is still believed: see
 * `agent-hud-beacon-liveness.ts` for the rule. The clock lives here, in one
 * timer per mounted HUD that fires at the next deadline and never on a
 * period, so a working agent costs no re-render until its window actually
 * closes. Cleared with the effect, so no timer outlives the view.
 */
export function useAgentHudBeaconLiveness(args: {
  handle: string | null
  agent: string | null
  phase: BeaconPhase
  beacon: AgentHudBeacon | null
}): boolean {
  const { handle, agent, phase, beacon } = args
  const [dead, setDead] = useState<{ handle: string; at: number } | null>(null)
  useEffect(() => {
    if (!handle) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => {
      const now = Date.now()
      const watch = stepBeaconWatch(readBeaconWatch(handle), {
        now,
        phase,
        arrivedAt: getAgentHudBeaconArrivedAt(handle)
      })
      writeBeaconWatch(handle, watch)
      const verdict = beaconWatchVerdict(watch, agent, now)
      setDead((current) => {
        if (verdict.live) {
          return current === null ? current : null
        }
        return current?.handle === handle ? current : { handle, at: now }
      })
      const nextAt = verdict.live
        ? verdict.recheckAt
        : phase === 'working'
          ? now + DEAD_RECHECK_MS
          : null
      if (nextAt !== null) {
        timer = setTimeout(check, Math.max(0, nextAt - now))
      }
    }
    check()
    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
    // `beacon` is a dependency on purpose: a new object means the store
    // published, which is the arrival this effect must count at once.
  }, [handle, agent, phase, beacon])
  return !(dead !== null && dead.handle === handle)
}
