/**
 * A beacon dies with its process.
 *
 * The beacon store is keyed by terminal handle, and a handle outlives the
 * process that emitted into it. On 2026-09-18 the phone read "Fable 5.1
 * medium" for a terminal whose process was a hand-started `claude -c`
 * painting "[Opus 5 (1M context) xhigh]": the phone-launched agent that had
 * run there before had left its last beacon in the store, the hand-started one
 * emits none (no `--settings`), and — verified on Claude Code 2.1.276 — `-c`
 * and `--resume` keep the SAME session id, so the session check alone cannot
 * tell the two apart. What can is silence, and only a beacon that promised
 * to speak can be silent. Two rules:
 *
 *  - HEARTBEAT, for a beacon that declares a beat (`hb=`). A phone-launched
 *    Claude is launched with `statusLine.refreshInterval`, which re-runs the
 *    status-line command — and so re-emits the beacon — every few seconds
 *    WHILE THE STATUS LINE IS MOUNTED. Verified live on 2.1.276: a beat every
 *    2 s through a 25 s foreground tool call and through idle time at the
 *    prompt. But the status line is unmounted, and the timer with it, under
 *    every full-screen picker and dialog: `/model`, a permission prompt, an
 *    AskUserQuestion card (0 beats in 25 s under each, same probe). A dialog
 *    is where the phone user sits and reads for minutes, so silence counts
 *    only while the agent is WORKING — Orca's status says `working`, not
 *    `blocked`/`waiting` — and the window starts afresh with each working
 *    stretch, so a picker left open before the prompt costs nothing. Dead
 *    after `BEACON_HEARTBEAT_SILENCE_MS` of that.
 *
 *    The first cut of this rule (93e3cc5) also timed working silence, but
 *    with no heartbeat behind it: Claude repaints on a new assistant message
 *    and not during a tool call, so a live session's pill went blank 30 s
 *    into any long tool call. The heartbeat is what makes the rule honest.
 *
 *  - TURN END, for every beacon. Both agents beacon when a turn ends: Codex's
 *    notify runs then and only then, Claude's Stop hook and its status line
 *    fire beside the repaint. A turn that ends and brings no beacon within
 *    `BEACON_TURN_END_GRACE_MS` is a turn the emitting process did not see.
 *    This is the only rule for a beacon with no declared beat (Codex; a
 *    Claude launched by a build before the field). An interrupted turn is not
 *    one: Codex reports nothing there, and nothing documents Claude's Stop
 *    hook firing on Escape.
 *
 * The phone hears a terminal only while its stream is subscribed, and it
 * unsubscribes the tab it leaves: every tab switch, foreground recovery,
 * relay reconnect and WebView reload goes through `subscribeToTerminal`,
 * which stamps the moment listening began (`noteAgentHudBeaconListening`).
 * Silence is measured from the latest of the last arrival, the start of the
 * working stretch and that stamp, so the beats that fell into a dead socket
 * or into a tab the phone had left are not silence, a warm-start record gets
 * a full window, and a fresh stamp forgets any turn end the watch was waiting
 * on (its beacon went into the unsubscribed stream). A chat/terminal flip of
 * the same tab resubscribes too — the view stream becomes a lease-only one
 * and back (`mobile-native-chat-terminal-stream.ts`) — so it moves the stamp
 * like any other; a beacon emitted in that gap is genuinely lost, and the
 * fresh window is the right call there as well.
 *
 * A write-off is a fact about the process: a fresh window is not evidence
 * against it, so a written-off beacon comes back only on a beat newer than
 * the write-off. Otherwise a turn end would have shown a dead record again
 * for the grace, and a tab switch or a chat/terminal flip for a whole window.
 *
 * Pure: the hook in `use-agent-hud-beacon-liveness.ts` owns the clock.
 */

/** Working silence after which a beacon with a declared beat is dead: six
 *  missed beats at the 5 s the phone launches with, and never less, so a
 *  single relay hiccup cannot kill a live one however fast the beat. */
export const BEACON_HEARTBEAT_SILENCE_MS = 30_000
export const BEACON_HEARTBEAT_MISSED_BEATS = 6
/** How long after a turn ends a beacon may still arrive and count for it. A
 *  Codex notify reads the whole rollout with sed first, and both agents'
 *  beacons ride the same relay as the status flip that marks the turn end. */
export const BEACON_TURN_END_GRACE_MS = 20_000
/** A beacon that landed this long BEFORE the status flip is the turn-end
 *  beacon arriving ahead of it, not an earlier one. */
export const BEACON_TURN_END_SLACK_MS = 10_000

/** What the tab's agent is doing. `working` is the only phase in which a
 *  live status line is sure to be mounted; `paused` (blocked on a dialog,
 *  waiting on a question) and `interrupted` (a `done` Orca marks as a
 *  cancellation) are not turn ends the agent would report; `idle` is what a
 *  completed turn ends into. */
export type BeaconPhase = 'working' | 'paused' | 'idle' | 'interrupted'

export type BeaconWatch = {
  /** The arrival this watch has counted; null: none this run. */
  arrivedAt: number | null
  /** The stream subscribe this watch has counted from. */
  listeningSince: number
  /** When the current working stretch began, or null outside one. */
  workingSince: number | null
  /** When the last turn ended with no arrival since, or null. */
  turnEndedAt: number | null
  /** When the beacon was declared dead, until a newer beat; null: live. */
  writtenOffAt: number | null
  /** The phase last observed, so the step into `idle` is seen as a turn end
   *  whether it comes from working or from a dialog the user answered. */
  phase: BeaconPhase
}

export function newBeaconWatch(listeningSince: number): BeaconWatch {
  return {
    arrivedAt: null,
    listeningSince,
    workingSince: null,
    turnEndedAt: null,
    writtenOffAt: null,
    phase: 'idle'
  }
}

export function stepBeaconWatch(
  watch: BeaconWatch,
  input: {
    now: number
    phase: BeaconPhase
    arrivedAt: number | null
    /** The stream's current subscribe stamp; newer than the watch's means the
     *  phone was not listening in between and nothing meanwhile is evidence. */
    listeningSince: number
  }
): BeaconWatch {
  let next = watch
  const resumed = input.listeningSince > watch.listeningSince
  if (resumed) {
    next = { ...next, listeningSince: input.listeningSince, turnEndedAt: null }
  }
  if (input.arrivedAt !== null && (next.arrivedAt === null || input.arrivedAt > next.arrivedAt)) {
    // The process spoke: whatever turn end was pending, it reported it, and
    // whatever write-off stood, it is over.
    next = {
      ...next,
      arrivedAt: input.arrivedAt,
      turnEndedAt: null,
      writtenOffAt:
        next.writtenOffAt !== null && input.arrivedAt > next.writtenOffAt ? null : next.writtenOffAt
    }
  }
  const working = input.phase === 'working'
  if (working && (next.workingSince === null || resumed)) {
    next = { ...next, workingSince: input.now }
  } else if (!working && next.workingSince !== null) {
    next = { ...next, workingSince: null }
  }
  const wasIdle = watch.phase === 'idle' || watch.phase === 'interrupted'
  if (input.phase === 'idle' && !wasIdle && !resumed) {
    // A turn just ended: it went idle from working, or from a dialog. Not
    // from `interrupted`: Orca does not keep that flag sticky, so the same
    // bare `done` can come round again with nothing having run in between.
    next = { ...next, turnEndedAt: input.now }
  } else if (input.phase !== 'idle' && watch.phase === 'idle') {
    // The next turn started; the last one's deadline no longer applies.
    next = { ...next, turnEndedAt: null }
  }
  return next.phase === input.phase ? next : { ...next, phase: input.phase }
}

/** The verdict became "dead" at `now`: remember it, so only a beat undoes it. */
export function writeOffBeaconWatch(watch: BeaconWatch, now: number): BeaconWatch {
  return watch.writtenOffAt === null ? { ...watch, writtenOffAt: now } : watch
}

/** Whether the beacon this watch follows is still believed, and when to look
 *  again (null: nothing pending, no timer needed). */
export function beaconWatchVerdict(
  watch: BeaconWatch,
  beacon: { heartbeatMs: number | null },
  now: number
): { live: boolean; recheckAt: number | null } {
  if (watch.writtenOffAt !== null) {
    return { live: false, recheckAt: null }
  }
  const deadlines: number[] = []
  if (beacon.heartbeatMs !== null && watch.workingSince !== null) {
    const silentSince = Math.max(watch.arrivedAt ?? 0, watch.listeningSince, watch.workingSince)
    deadlines.push(
      silentSince + Math.max(BEACON_HEARTBEAT_SILENCE_MS, BEACON_HEARTBEAT_MISSED_BEATS * beacon.heartbeatMs)
    )
  }
  if (
    watch.turnEndedAt !== null &&
    // Not when the turn-end beacon landed just before the flip.
    (watch.arrivedAt === null || watch.turnEndedAt - watch.arrivedAt > BEACON_TURN_END_SLACK_MS)
  ) {
    deadlines.push(watch.turnEndedAt + BEACON_TURN_END_GRACE_MS)
  }
  if (deadlines.length === 0) {
    return { live: true, recheckAt: null }
  }
  const deadline = Math.min(...deadlines)
  return now >= deadline ? { live: false, recheckAt: null } : { live: true, recheckAt: deadline }
}

/** One watch per terminal handle, at MODULE scope like the beacon store it
 *  follows: the chat view is torn down and rebuilt on every chat/terminal flip
 *  and route change, and a watch that reset with it would never reach its
 *  window. Oldest shed first. */
const watches = new Map<string, BeaconWatch>()
const BEACON_WATCH_CAP = 32

export function readBeaconWatch(handle: string, listeningSince: number): BeaconWatch {
  return watches.get(handle) ?? newBeaconWatch(listeningSince)
}

/** The standing verdict for a handle, for a reader that needs it before the
 *  hook's clock has run — a tab switched back to a written-off handle must
 *  not show the dead record for a render. */
export function isBeaconWrittenOff(handle: string | null): boolean {
  return handle !== null && (watches.get(handle)?.writtenOffAt ?? null) !== null
}

export function writeBeaconWatch(handle: string, watch: BeaconWatch): void {
  watches.delete(handle)
  watches.set(handle, watch)
  while (watches.size > BEACON_WATCH_CAP) {
    const oldest = watches.keys().next().value
    if (oldest === undefined) {
      break
    }
    watches.delete(oldest)
  }
}

/** When the phone (re)subscribed each terminal's stream, this run; absent
 *  while it is not subscribed. Stamped by the terminal layer's own
 *  subscribe/unsubscribe, which every tab switch, foreground recovery,
 *  reconnect and WebView reload goes through. */
const listening = new Map<string, number>()
const listeningListeners = new Set<() => void>()

export function noteAgentHudBeaconListening(handle: string, on: boolean, at = Date.now()): void {
  if (on) {
    listening.set(handle, at)
  } else if (!listening.delete(handle)) {
    return
  }
  for (const listener of listeningListeners) {
    listener()
  }
}

export function getAgentHudBeaconListeningSince(handle: string | null): number | null {
  return handle ? (listening.get(handle) ?? null) : null
}

export function subscribeAgentHudBeaconListening(listener: () => void): () => void {
  listeningListeners.add(listener)
  return () => {
    listeningListeners.delete(listener)
  }
}

/** With the beacon store: the handles are gone, and so is what was watched. */
export function resetBeaconWatches(): void {
  watches.clear()
  const wasListening = listening.size > 0
  listening.clear()
  if (wasListening) {
    for (const listener of listeningListeners) {
      listener()
    }
  }
}
