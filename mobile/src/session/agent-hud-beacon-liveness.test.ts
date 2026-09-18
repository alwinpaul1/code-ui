import { describe, expect, it } from 'vitest'
import {
  BEACON_TURN_END_GRACE_MS,
  BEACON_WORKING_SILENCE_MS,
  beaconWatchVerdict,
  NEW_BEACON_WATCH,
  stepBeaconWatch,
  type BeaconPhase,
  type BeaconWatch
} from './agent-hud-beacon-liveness'

/** Walks a watch through a timeline of (time, phase, last arrival) readings
 *  and returns the watch after the last one. */
function walk(
  steps: readonly { at: number; phase: BeaconPhase; arrivedAt?: number | null }[],
  from: BeaconWatch = NEW_BEACON_WATCH
): BeaconWatch {
  let watch = from
  let arrived: number | null = null
  for (const step of steps) {
    if (step.arrivedAt !== undefined) {
      arrived = step.arrivedAt
    }
    watch = stepBeaconWatch(watch, { now: step.at, phase: step.phase, arrivedAt: arrived })
  }
  return watch
}

const s = (seconds: number) => seconds * 1000

// 2026-09-18: a phone-launched Claude repaints its status line several times
// a second while it works, and each repaint re-emits the beacon. A beacon that
// stays silent through half a minute of the agent's work is from a process
// that is no longer painting — the one that ran in this terminal before — and
// the phone must stop stating its model rather than keep the past on screen.
describe('a Claude beacon dies with its process', () => {
  it('is held through 29 s of working silence', () => {
    const watch = walk([{ at: s(0), phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, 'claude', s(29)).live).toBe(true)
  })

  it('is dropped after 31 s of working silence', () => {
    const watch = walk([{ at: s(0), phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, 'claude', s(31)).live).toBe(false)
  })

  it('is held through five idle minutes: an idle agent does not repaint', () => {
    const watch = walk([{ at: s(0), phase: 'idle', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, 'claude', s(300)).live).toBe(true)
  })

  it('does not count time spent waiting on a permission prompt as working', () => {
    // Blocked on a dialog the status line does not repaint either; a live
    // session must not lose its figures for sitting on an approval card.
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: s(0) },
      { at: s(5), phase: 'paused' }
    ])
    expect(beaconWatchVerdict(watch, 'claude', s(120)).live).toBe(true)
  })

  it('starts the window again on a fresh beacon at 20 s', () => {
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(20), phase: 'working', arrivedAt: s(20) }
    ])
    expect(beaconWatchVerdict(watch, 'claude', s(45)).live).toBe(true)
    expect(beaconWatchVerdict(watch, 'claude', s(51)).live).toBe(false)
  })

  it('adds working stretches up across a dialog in between', () => {
    // 20 s of work, 80 s blocked on a permission card, then 12 s more with no
    // beacon: 32 s silent. (An IDLE gap is a turn end, which is its own rule.)
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(20), phase: 'paused' },
      { at: s(100), phase: 'working' }
    ])
    expect(beaconWatchVerdict(watch, 'claude', s(108)).live).toBe(true)
    expect(beaconWatchVerdict(watch, 'claude', s(112)).live).toBe(false)
  })

  it('treats a warm-start record as never having arrived', () => {
    // No arrival this run: the first working stretch is the whole window.
    const watch = walk([{ at: s(0), phase: 'working', arrivedAt: null }])
    expect(watch.arrivedAt).toBeNull()
    expect(beaconWatchVerdict(watch, 'claude', s(30)).live).toBe(false)
  })

  it('says when to look again, so nothing has to poll', () => {
    const watch = walk([{ at: s(0), phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, 'claude', s(10)).recheckAt).toBe(BEACON_WORKING_SILENCE_MS)
    expect(beaconWatchVerdict(walk([{ at: s(0), phase: 'idle' }]), 'claude', s(10)).recheckAt).toBeNull()
  })
})

// Codex runs its notify command once, after each turn — never mid-turn — so
// working silence proves nothing on that lane. What a live Codex always does
// is beacon at the END of a turn. A turn that ends and brings no beacon within
// the grace is a turn the emitting process did not see.
describe('a Codex beacon dies with its process', () => {
  it('is held through a long working turn, since Codex only beacons at the end', () => {
    const watch = walk([{ at: s(0), phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, 'codex', s(600)).live).toBe(true)
  })

  it('is dropped when a turn ends and no beacon follows within the grace', () => {
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(40), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, 'codex', s(40) + BEACON_TURN_END_GRACE_MS - 1000).live).toBe(true)
    expect(beaconWatchVerdict(watch, 'codex', s(40) + BEACON_TURN_END_GRACE_MS + 1000).live).toBe(false)
  })

  it('is held when the turn-end beacon lands just after the status flip', () => {
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(40), phase: 'idle' },
      { at: s(43), phase: 'idle', arrivedAt: s(43) }
    ])
    expect(beaconWatchVerdict(watch, 'codex', s(120)).live).toBe(true)
  })

  it('is held when the turn-end beacon landed just BEFORE the status flip', () => {
    // Both ride the same relay; the order they land in is not a fact about
    // the process.
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(38), phase: 'working', arrivedAt: s(38) },
      { at: s(40), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, 'codex', s(120)).live).toBe(true)
  })

  it('applies the turn-end rule to Claude as well, for a turn shorter than the silence window', () => {
    // A hand-started `claude -c` that answers in ten seconds never works for
    // 30 s, and the Stop hook of a live phone-launched one always beacons.
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(10), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, 'claude', s(10) + BEACON_TURN_END_GRACE_MS + 1000).live).toBe(false)
  })

  it('does not call a permission prompt a turn end', () => {
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: s(0) },
      { at: s(10), phase: 'paused' }
    ])
    expect(beaconWatchVerdict(watch, 'codex', s(600)).live).toBe(true)
  })
})

describe('the degenerate watch', () => {
  it('is live before anything has been observed', () => {
    expect(beaconWatchVerdict(NEW_BEACON_WATCH, 'claude', s(999)).live).toBe(true)
    expect(beaconWatchVerdict(NEW_BEACON_WATCH, null, s(999)).live).toBe(true)
  })

  it('does not count a stretch that began before the beacon arrived', () => {
    // The agent was already working when its beacon landed at 25 s; only the
    // time after the arrival is silence.
    const watch = walk([
      { at: s(0), phase: 'working', arrivedAt: null },
      { at: s(25), phase: 'working', arrivedAt: s(25) }
    ])
    expect(beaconWatchVerdict(watch, 'claude', s(50)).live).toBe(true)
    expect(beaconWatchVerdict(watch, 'claude', s(56)).live).toBe(false)
  })
})
