import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { getAgentHudBeaconArrivedAt, type AgentHudBeacon } from './agent-hud-beacon'
import {
  beaconWatchVerdict,
  getAgentHudBeaconListeningSince,
  isBeaconWrittenOff,
  readBeaconWatch,
  stepBeaconWatch,
  subscribeAgentHudBeaconListening,
  writeBeaconWatch,
  writeOffBeaconWatch,
  type BeaconPhase
} from './agent-hud-beacon-liveness'

/** While a beacon is written off, look this often for a beat whose bytes
 *  repeat the dead one's exactly — such a repeat is an arrival the store does
 *  not republish (the figures did not move), so nothing else would re-run
 *  this. */
const DEAD_RECHECK_MS = 5_000

/**
 * Whether the beacon held for `handle` is still believed: see
 * `agent-hud-beacon-liveness.ts` for the rule. The clock lives here, in one
 * timer per mounted HUD that fires at the next deadline and never on a
 * period, so a live agent costs no re-render until its window actually
 * closes. Cleared with the effect, so no timer outlives the view.
 *
 * `listening` is the HUD's `enabled`: chat shown over a connected relay.
 * The watch runs only while that holds AND the terminal layer says the
 * handle's stream is subscribed; the subscribe stamp is what the watch
 * measures silence from, and a new one is what tells it the phone was away.
 *
 * The verdict itself lives on the module-level watch, so a tab switched back
 * to a written-off handle reads as written off on its first render rather
 * than showing the dead record until the clock has run once. This hook is
 * the watch's only writer, so the read is as current as React's own state.
 */
export function useAgentHudBeaconLiveness(args: {
  handle: string | null
  listening: boolean
  phase: BeaconPhase
  beacon: AgentHudBeacon | null
}): boolean {
  const { handle, listening, phase, beacon } = args
  const heartbeatMs = beacon?.heartbeatSeconds == null ? null : beacon.heartbeatSeconds * 1000
  const listeningSince = useSyncExternalStore(
    subscribeAgentHudBeaconListening,
    () => getAgentHudBeaconListeningSince(handle),
    () => null
  )
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!handle || !listening || listeningSince === null) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => {
      const now = Date.now()
      const before = isBeaconWrittenOff(handle)
      const stepped = stepBeaconWatch(readBeaconWatch(handle, listeningSince), {
        now,
        phase,
        arrivedAt: getAgentHudBeaconArrivedAt(handle),
        listeningSince
      })
      const verdict = beaconWatchVerdict(stepped, { heartbeatMs }, now)
      writeBeaconWatch(handle, verdict.live ? stepped : writeOffBeaconWatch(stepped, now))
      if (isBeaconWrittenOff(handle) !== before) {
        rerender()
      }
      const nextAt = verdict.live ? verdict.recheckAt : now + DEAD_RECHECK_MS
      timer = nextAt === null ? null : setTimeout(check, Math.max(0, nextAt - now))
    }
    check()
    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
    // `beacon` is a dependency on purpose: a new object means the store
    // published, which is the arrival this effect must count at once.
  }, [handle, listening, listeningSince, phase, beacon, heartbeatMs])
  return !isBeaconWrittenOff(handle)
}
