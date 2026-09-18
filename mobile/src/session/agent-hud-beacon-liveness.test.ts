import { describe, expect, it } from 'vitest'
import {
  BEACON_HEARTBEAT_SILENCE_MS,
  BEACON_TURN_END_GRACE_MS,
  beaconWatchVerdict,
  newBeaconWatch,
  stepBeaconWatch,
  writeOffBeaconWatch,
  type BeaconPhase,
  type BeaconWatch
} from './agent-hud-beacon-liveness'

const s = (seconds: number) => seconds * 1000
/** What a phone-launched Claude declares: a status-line repaint every 5 s. */
const HEARTBEAT = { heartbeatMs: s(5) }
/** What Codex declares: nothing. It beacons only when a turn ends. */
const NO_HEARTBEAT = { heartbeatMs: null }

type Step = { at: number; phase: BeaconPhase; arrivedAt?: number | null; resumed?: boolean }

/** Walks a watch through a timeline of readings and returns the watch after
 *  the last one. The phone subscribed the stream at t=0; a `resumed` step is
 *  a fresh subscribe at that moment (a tab switch back, a foreground
 *  recovery, a reconnect), which is how the phone knows it was not listening. */
function walk(steps: readonly Step[], from: BeaconWatch = newBeaconWatch(0)): BeaconWatch {
  let watch = from
  let arrived: number | null = null
  let listeningSince = 0
  for (const step of steps) {
    if (step.arrivedAt !== undefined) {
      arrived = step.arrivedAt
    }
    if (step.resumed) {
      listeningSince = step.at
    }
    watch = stepBeaconWatch(watch, {
      now: step.at,
      phase: step.phase,
      arrivedAt: arrived,
      listeningSince
    })
  }
  return watch
}

// 2026-09-18: a phone-launched Claude runs its status-line command — and so
// emits the beacon — every `refreshInterval` seconds while the status line is
// mounted, tool call or not (verified live on Claude Code 2.1.276 with a 25 s
// foreground tool call: a beat every 2 s, largest gap 3 s). A beacon that
// declares that heartbeat and then falls silent while the agent works is from
// a process that is no longer running the command: the one that ran in this
// terminal before.
describe('a beacon that declares a heartbeat dies with its process', () => {
  it('stays live through five minutes of continuous work with a beat every 5 s', () => {
    // The reviewer's case on 93e3cc5: a long tool call or a subagent run. No
    // assistant message for minutes, and the pill and ring must not blank.
    const steps: Step[] = [{ at: 0, phase: 'working', arrivedAt: 0 }]
    for (let t = 5; t <= 300; t += 5) {
      steps.push({ at: s(t), phase: 'working', arrivedAt: s(t) })
    }
    const watch = walk(steps)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(302)).live).toBe(true)
  })

  it('is held through 29 s of working silence and dropped after 31 s', () => {
    const watch = walk([{ at: 0, phase: 'working', arrivedAt: 0 }])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(29)).live).toBe(true)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(31)).live).toBe(false)
  })

  // The same probe: under `/model`, a permission prompt and an
  // AskUserQuestion card the status line is unmounted and the timer stops
  // with it — 0 beats in 25 s under each. A dialog is where the phone user
  // sits and reads for minutes.
  it('is held for as long as a dialog or a question is up: the status line is unmounted there', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(5), phase: 'paused' }
    ])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(600)).live).toBe(true)
  })

  it('is held through five idle minutes, where a picker can have the status line down', () => {
    const watch = walk([{ at: 0, phase: 'idle', arrivedAt: 0 }])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(300)).live).toBe(true)
  })

  it('starts a fresh window when a turn starts, not from the last beat before the picker', () => {
    // Five minutes in `/model` with no beat, then a prompt: the beat resumes
    // within a second of the picker closing, and the window must not be
    // already spent when the turn opens.
    const watch = walk([
      { at: 0, phase: 'idle', arrivedAt: 0 },
      { at: s(300), phase: 'working' }
    ])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(320)).live).toBe(true)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(331)).live).toBe(false)
  })

  it('starts the window again on every beat', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(20), phase: 'working', arrivedAt: s(20) }
    ])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(45)).live).toBe(true)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(51)).live).toBe(false)
  })

  it('measures a warm-start record from when the phone began listening, not from the dawn of time', () => {
    // Restored from disk at t=0, working since, nothing heard: dead at 30 s.
    const watch = walk([{ at: 0, phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(10)).live).toBe(true)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(30)).live).toBe(false)
  })

  it('measures from the moment the phone resumes listening, so a backgrounded app does not blank the pill on return', () => {
    // Last beat at 10 s, app backgrounded (timers suspended, socket dead),
    // back at 5 min mid-turn: the process may well be alive; a full window.
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(10), phase: 'working', arrivedAt: s(10) },
      { at: s(300), phase: 'working', resumed: true }
    ])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(320)).live).toBe(true)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(331)).live).toBe(false)
  })

  it('scales the window to the declared beat, never below the floor', () => {
    const watch = walk([{ at: 0, phase: 'working', arrivedAt: 0 }])
    // A 10 s beat: six misses is 60 s.
    expect(beaconWatchVerdict(watch, { heartbeatMs: s(10) }, s(45)).live).toBe(true)
    expect(beaconWatchVerdict(watch, { heartbeatMs: s(10) }, s(61)).live).toBe(false)
    // A 1 s beat: the floor holds, so one relay hiccup cannot kill it.
    expect(beaconWatchVerdict(watch, { heartbeatMs: s(1) }, s(20)).live).toBe(true)
    expect(beaconWatchVerdict(watch, { heartbeatMs: s(1) }, BEACON_HEARTBEAT_SILENCE_MS + 1).live).toBe(false)
  })

  it('is also caught at a turn end it did not report, like any other beacon', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(10), phase: 'working', arrivedAt: s(10) },
      { at: s(25), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(25) + BEACON_TURN_END_GRACE_MS + 1000).live).toBe(false)
  })

  it('says when to look again, so nothing has to poll', () => {
    const watch = walk([{ at: 0, phase: 'working', arrivedAt: s(4) }])
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(10)).recheckAt).toBe(s(4) + BEACON_HEARTBEAT_SILENCE_MS)
    expect(beaconWatchVerdict(walk([{ at: 0, phase: 'idle', arrivedAt: 0 }]), HEARTBEAT, s(10)).recheckAt).toBeNull()
  })
})

// Codex runs its notify command once, after each turn — never mid-turn and
// never idle — so silence proves nothing on that lane. What a live Codex always
// does is beacon at the END of a turn. A turn that ends and brings no beacon
// within the grace is a turn the emitting process did not see. A Claude beacon
// from an emitter that declares no heartbeat is read the same way.
describe('a beacon with no heartbeat dies at a turn end it did not report', () => {
  it('is held through a long working turn', () => {
    const watch = walk([{ at: 0, phase: 'working', arrivedAt: null }])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(600)).live).toBe(true)
  })

  it('is held through a long idle stretch', () => {
    const watch = walk([{ at: 0, phase: 'idle', arrivedAt: 0 }])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(3600)).live).toBe(true)
  })

  it('is dropped when a turn ends and no beacon follows within the grace', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: null },
      { at: s(40), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(40) + BEACON_TURN_END_GRACE_MS - 1000).live).toBe(true)
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(40) + BEACON_TURN_END_GRACE_MS + 1000).live).toBe(false)
  })

  it('is held when the turn-end beacon lands just after the status flip', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: null },
      { at: s(40), phase: 'idle' },
      { at: s(43), phase: 'idle', arrivedAt: s(43) }
    ])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(120)).live).toBe(true)
  })

  it('is held when the turn-end beacon landed just BEFORE the status flip', () => {
    // Both ride the same relay; the order they land in is not a fact about
    // the process.
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: null },
      { at: s(38), phase: 'working', arrivedAt: s(38) },
      { at: s(40), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(120)).live).toBe(true)
  })

  it('does not call a permission prompt a turn end', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(10), phase: 'paused' }
    ])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(600)).live).toBe(true)
  })

  it('does not call an interrupt a turn end: the agent reports none there', () => {
    // Codex's notify fires only on agent-turn-complete, and nothing documents
    // Claude's Stop hook firing on Escape. Orca marks the resulting `done` as
    // interrupted, and that is not a turn the process would have beaconed.
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(10), phase: 'interrupted' }
    ])
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(600)).live).toBe(true)
  })

  it('does not read an interrupted done re-sent without its flag as a turn end', () => {
    // Orca documents `interrupted` as "undefined otherwise", not as sticky:
    // a tabs re-send or a hydrate can carry the same `done` bare. Nothing
    // ran in between, so no turn ended.
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(10), phase: 'interrupted' },
      { at: s(15), phase: 'idle' }
    ])
    expect(watch.turnEndedAt).toBeNull()
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(600)).live).toBe(true)
  })

  // Review of 93e3cc5: `turnEndedAt` was cleared only by an arrival, so a new
  // turn that opened with a tool call — no beacon yet — still carried the
  // previous turn's deadline and could be killed 20 s into the new turn.
  it('forgets a turn-end deadline once the next turn starts', () => {
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(40), phase: 'idle' },
      { at: s(42), phase: 'working' }
    ])
    expect(watch.turnEndedAt).toBeNull()
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(61)).live).toBe(true)
  })

  it('does not count a turn that ended while the phone was not listening', () => {
    // Working when the app went to the background, idle when it came back:
    // the turn-end beacon was emitted into a dead socket, not withheld.
    const watch = walk([
      { at: 0, phase: 'working', arrivedAt: 0 },
      { at: s(300), phase: 'idle', resumed: true }
    ])
    expect(watch.turnEndedAt).toBeNull()
    expect(beaconWatchVerdict(watch, NO_HEARTBEAT, s(330)).live).toBe(true)
  })

  it('says when to look again, so nothing has to poll', () => {
    const ended = walk([
      { at: 0, phase: 'working', arrivedAt: null },
      { at: s(40), phase: 'idle' }
    ])
    expect(beaconWatchVerdict(ended, NO_HEARTBEAT, s(45)).recheckAt).toBe(s(40) + BEACON_TURN_END_GRACE_MS)
    expect(beaconWatchVerdict(walk([{ at: 0, phase: 'working' }]), NO_HEARTBEAT, s(10)).recheckAt).toBeNull()
  })
})

// A verdict of dead is a fact about the process, and a fresh window (a turn
// end, a tab switch back, a reconnect) is not evidence against it. Only a
// beat is.
describe('a written-off beacon', () => {
  it('stays written off through a turn end, rather than coming back for the grace', () => {
    let watch = walk([{ at: 0, phase: 'working', arrivedAt: 0 }])
    watch = writeOffBeaconWatch(watch, s(31))
    watch = walk([{ at: s(32), phase: 'idle' }], watch)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(33)).live).toBe(false)
  })

  it('stays written off through a resubscribe', () => {
    let watch = walk([{ at: 0, phase: 'working', arrivedAt: 0 }])
    watch = writeOffBeaconWatch(watch, s(31))
    watch = walk([{ at: s(100), phase: 'working', resumed: true }], watch)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(101)).live).toBe(false)
  })

  it('comes back on a beat, and only on a beat newer than the write-off', () => {
    let watch = walk([{ at: 0, phase: 'working', arrivedAt: 0 }])
    watch = writeOffBeaconWatch(watch, s(31))
    expect(beaconWatchVerdict(walk([{ at: s(32), phase: 'working', arrivedAt: 0 }], watch), HEARTBEAT, s(32)).live).toBe(false)
    watch = walk([{ at: s(40), phase: 'working', arrivedAt: s(40) }], watch)
    expect(beaconWatchVerdict(watch, HEARTBEAT, s(41)).live).toBe(true)
  })
})

describe('the degenerate watch', () => {
  it('is live before anything has been observed', () => {
    expect(beaconWatchVerdict(newBeaconWatch(s(999)), HEARTBEAT, s(999)).live).toBe(true)
    expect(beaconWatchVerdict(newBeaconWatch(s(999)), NO_HEARTBEAT, s(999)).live).toBe(true)
  })

  it('ignores an arrival older than the one it already counted', () => {
    const watch = walk([
      { at: 0, phase: 'idle', arrivedAt: s(20) },
      { at: s(25), phase: 'idle', arrivedAt: s(10) }
    ])
    expect(watch.arrivedAt).toBe(s(20))
  })
})
