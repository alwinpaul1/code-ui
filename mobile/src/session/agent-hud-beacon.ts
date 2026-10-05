import { useSyncExternalStore } from 'react'
import { resetAgentHudChannels, takeAgentHudChannelFor } from './agent-hud-channel'
import { readDesktopPrompt } from './agent-hud-beacon-desktop-prompt'
import { keepStopList, restamp, stopList, unchangedBeacon } from './agent-hud-beacon-identity'
import { resetBeaconWatches } from './agent-hud-beacon-liveness'
import {
  readWarmStartBeacons,
  rememberWarmStartBeacon
} from './agent-hud-beacon-warm-start'
import { agentMessagesIdentity, withAgentMessagePlaced, withAgentMessagesOf, withRestoredAgentMessages, type AgentMessagePrompt } from './agent-hud-beacon-agent-messages'

// Re-exported: two tests import it from this module.
export { unescapeJsonStringBody } from './agent-hud-beacon-desktop-prompt'

/**
 * The phone half of the invisible HUD channel.
 *
 * Each agent writes a `CUIHUD1 key=value …` payload straight to its own PTY
 * (see `agent-hud-launch-args.ts`), framed in four C0 bytes no terminal draws
 * or acts on (`agent-hud-channel.ts`). The phone already receives that PTY
 * byte stream, so it takes those bytes out wherever they landed, keeps the
 * payload, and hands the rest on unchanged.
 *
 * The older frame, `ESC ] 7777 ; … BEL`, is still read: a tab launched with
 * the old flags keeps writing it until its agent restarts. That one could be
 * spliced into the agent's own escapes and draw text on the desktop, which is
 * why the writers moved off it. OSC 7777 is in the private range; anything
 * else that looks like an OSC (`ESC ] 0 ; title BEL`, for one) is passed
 * through untouched.
 */

const OSC_PREFIX = '\u001b]7777;'
const BEL = '\u0007'
const ST = '\u001b\\'

/** A sequence split across chunks is stitched, but only up to this much held
 *  back. A truncated write must not swallow the terminal's output forever. */
const MAX_CARRY = 2048

export type AgentHudBeaconLimit = {
  name: string
  usedPercent: number
  /** Epoch SECONDS, matching what the context sheet's clock expects. */
  resetsAt: number | null
}

/** A desktop submission: the hook's process id (so two identical prompts stay
 *  distinct), the text, and whether the hook had to shorten it. */
/** `anchorId`: the transcript's last user/assistant row (its uuid, which is
 *  the phone's message id) at the moment the prompt was submitted, beaconed
 *  by the hook as `at=`. The echo anchors right after that row wherever it
 *  sits, so a late-arriving beacon cannot land the message turns too low. */
/** `at`: epoch ms of the submission, when the source knows it (the transcript
 *  does; the beacon does not) — places the echo after the last row written
 *  before it when `anchorId` names a row the phone never holds. */
/** `ifHarnessStarted` on a held copy: the start of the run it came in, and
 *  each turn end the pane carried it past, with the start of the run after
 *  it. It is placed there if the rows show a harness message started each of
 *  those runs (desk-prompt-harness-turns.ts). */
/** `seenAt` on a beacon copy: when the phone received it (a restored one from
 *  an older build: its record's last beacon, agent-hud-beacon-warm-start.ts). */
/** `typedAt` on a beacon copy: epoch ms of the second the prompt hook ran, by
 *  the desk clock the transcript's rows are stamped by (`ts=`, 2026-09-29).
 *  Only placement reads it (use-desktop-prompt-echoes.ts); it is not `at`,
 *  which marks a copy the transcript witnessed and pairs it with the phone's
 *  own sends. Absent from a tab launched before the hook sent it. */
/** `atStateStart`: `at` is when the pane's working run began, read at first
 *  sight of the tab status (agent-status-prompts.ts), which can be before the
 *  prompt (one sent mid-run).
 *  `heldBack`: a status prompt whose time the status does not hold, found on a
 *  pane whose state began after it was taken. It has no `at`, pairs like any
 *  other copy (a phone send still claims its own), and is never drawn.
 *  `seenAt`: when the phone first read a status prompt, by the phone's clock.
 *  `hookTwin`: on a status prompt, the prompt hook's copy of the same
 *  submission it stands for (mergeDesktopPrompts): the hook's nonce, the text
 *  row it names, and when it reached the phone.
 *  `foundAt`: on a status prompt read first after Orca's stand-in, which may
 *  have been found or watched arriving, the start of the run it came in;
 *  `standInAt`, when the phone read that stand-in, by its own clock. */
export type DesktopPrompt = { nonce: string; text: string; cut?: boolean; /** The prompt hook saw a loop fire this prompt (`sc=1`): a tick, never typed (scheduled-prompt-ticks.ts). */ scheduled?: true; anchorId?: string; at?: number; atStateStart?: true; heldBack?: true; ifHarnessStarted?: { at: number; crossings: readonly { after: number; before: number }[] }; seenAt?: number; typedAt?: number; hookTwin?: { nonce: string; anchorId?: string; seenAt?: number }; foundAt?: number; standInAt?: number }

export type AgentHudBeacon = {
  agent: string
  /** The session this beacon speaks for: Claude Code's `session_id`, Codex's
   *  thread id. Null from an emitter that sent none. The store is keyed by
   *  terminal handle, and a handle outlives the process that emitted into it
   *  — on 2026-09-18 a hand-started `claude -c` inherited the last beacon of
   *  the phone-launched agent that had run in its terminal before, and the
   *  pill said Fable on an Opus session. Readers believe a beacon only for the
   *  session the tab is showing (`agentHudBeaconMatches`). */
  sessionId: string | null
  /** The beat this beacon promises, in seconds: the `refreshInterval` the
   *  phone launched Claude Code with, which re-runs the status-line command
   *  on a timer while its status line is mounted (idle, working, tool call;
   *  not under a dialog or picker). Null from an emitter that
   *  declares none (Codex, or a build before the field), for which silence
   *  means nothing. Read by `agent-hud-beacon-liveness.ts`. */
  heartbeatSeconds: number | null
  modelId: string | null
  modelLabel: string | null
  effort: string | null
  usedTokens: number | null
  windowTokens: number | null
  /** The agent's own percentage when it states one; null otherwise. Never
   *  derived from a window we guessed at. */
  usedPercent: number | null
  limits: AgentHudBeaconLimit[]
  /** Background tasks whose completion Claude has written to its transcript,
   *  mid-turn ones included — the notifications Orca's reader never surfaces. */
  doneTaskIds: string[]
  /** Ids the agent itself reports as still running, from its Stop hook. Null
   *  when this beacon did not carry the field, which is not the same as an
   *  empty list: empty means "nothing is running", null means "no answer". */
  runningTaskIds: string[] | null
  /** Whether this terminal was launched with the desktop-prompt hook. */
  promptHook: boolean
  /** Null on every beacon that is not a prompt submission. */
  desktopPrompt: DesktopPrompt | null
  /** The last desktop prompts seen on this terminal (MAX_DESKTOP_PROMPTS),
   *  oldest first, newest last. */
  desktopPrompts: DesktopPrompt[]
  /** The subagent messages among them, kept apart from that rolling list so
   *  their rows stay drawn (agent-hud-beacon-agent-messages.ts). Absent until
   *  one arrives. */
  agentMessagePrompts?: AgentMessagePrompt[]
  /** When `runningTaskIds` was received (phone clock, epoch ms); null until a
   *  beacon has carried `run=`. The Stop hook speaks only when a turn ends,
   *  so its list cannot name a shell launched after it — the reader uses this
   *  to keep an old answer from retiring a new launch. */
  runningTaskIdsAt: number | null
  /** The last Stop hook's `run=` alone, kept apart from `runningTaskIds`, which
   *  the status line's `live=` (every repaint, built from Bash launch sentences
   *  only) replaces. A workflow or a monitor is named by no `live=`, so only
   *  this list can say one has ended. Null until a Stop has spoken. */
  stopRunningTaskIds?: string[] | null
  /** When that Stop's beacon arrived (phone clock, epoch ms). */
  stopRunningTaskIdsAt?: number | null
  /** Every shell the transcript tail shows launched, from the status-line
   *  beacon on every refresh — fresh mid-turn, where `run=` is not. */
  launchedTaskIds: string[]
  receivedAt: number
}

const beacons = new Map<string, AgentHudBeacon>()
const carries = new Map<string, string>()
const listeners = new Set<() => void>()
/** When a beacon last ARRIVED on each handle, this run (phone clock, epoch
 *  ms). Not the beacon's `receivedAt`: a repeat that says nothing new is
 *  deliberately not republished, but it still proves the process is painting,
 *  which is what `agent-hud-beacon-liveness.ts` needs to know. A warm-start
 *  record never arrived this run and has no entry. */
const arrivals = new Map<string, number>()

/** A session id is a uuid (Claude Code) or a ULID-shaped thread id (Codex);
 *  anything outside this shape is not one and is refused rather than compared. */
const SESSION_ID = /^[A-Za-z0-9._-]{4,128}$/

function decodeValue(value: string): string {
  return value
    .replace(/%20/g, ' ')
    .replace(/%3B/gi, ';')
    .replace(/%25/g, '%')
}

function toInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** `h5=37:1788967200` — percentage, then the epoch second it resets at. */
function parseLimit(name: string, raw: string | undefined): AgentHudBeaconLimit | null {
  if (!raw) {
    return null
  }
  const [percent, resets] = raw.split(':')
  const usedPercent = toInt(percent)
  if (usedPercent === null) {
    return null
  }
  const resetsAt = toInt(resets)
  return { name, usedPercent, resetsAt: resetsAt === null || resetsAt === 0 ? null : resetsAt }
}

/** Parses one payload. Returns null for anything that is not a CUIHUD1 line,
 *  so a future version can be added without this build misreading it. */
export function parseAgentHudBeaconPayload(
  payload: string,
  receivedAt = Date.now()
): AgentHudBeacon | null {
  const fields = payload.trim().split(' ').filter(Boolean)
  if (fields.shift() !== 'CUIHUD1') {
    return null
  }
  const values = new Map<string, string>()
  for (const field of fields) {
    const split = field.indexOf('=')
    if (split > 0) {
      values.set(field.slice(0, split), decodeValue(field.slice(split + 1)))
    }
  }
  const agent = values.get('agent')
  if (!agent) {
    return null
  }
  const limits: AgentHudBeaconLimit[] = []
  // The names the context sheet already draws for the host's own feed.
  const session = parseLimit('Session', values.get('h5'))
  const weekly = parseLimit('Weekly', values.get('d7'))
  if (session) {
    limits.push(session)
  }
  if (weekly) {
    limits.push(weekly)
  }
  const sid = values.get('sid')
  return {
    agent,
    sessionId: sid !== undefined && SESSION_ID.test(sid) ? sid : null,
    // `hb=0` is no beat, not a beat of zero.
    heartbeatSeconds: toInt(values.get('hb')) || null,
    modelId: values.get('model') ?? null,
    modelLabel: values.get('name') ?? null,
    effort: values.get('effort') ?? null,
    usedTokens: toInt(values.get('used')),
    windowTokens: toInt(values.get('win')),
    usedPercent: toInt(values.get('pct')),
    limits,
    doneTaskIds: (values.get('done') ?? '')
      .split(',')
      .filter((id) => /^[A-Za-z0-9_-]+$/.test(id)),
    // `live` (status line, every refresh: launched minus finished over the
    // whole transcript) beats `run` (Stop hook, only at turn end), which
    // could not know about a shell started later in a long turn.
    runningTaskIds: liveOrRun(values),
    runningTaskIdsAt: values.has('live') || values.has('run') ? receivedAt : null,
    ...(values.has('run') ? stopList(values.get('run'), receivedAt) : {}),
    promptHook: values.get('hk') === '1',
    desktopPrompt: readDesktopPrompt(values.get('up'), values.get('cut') === '1', values.get('at'), values.get('ts'), values.get('sc') === '1'),
    desktopPrompts: [],
    launchedTaskIds: (values.get('bg') ?? '')
      .split(',')
      .filter((id) => /^[A-Za-z0-9_-]+$/.test(id)),
    receivedAt
  }
}

/** How many trailing bytes of `text` could be the start of our prefix. */
function splitPrefixLength(text: string): number {
  const max = Math.min(OSC_PREFIX.length - 1, text.length)
  for (let keep = max; keep > 0; keep -= 1) {
    if (text.endsWith(OSC_PREFIX.slice(0, keep))) {
      return keep
    }
  }
  return 0
}

/** What the warm start actually needs; a repainting agent must not write to
 *  disk on every frame just because its token count moved. */
function beaconIdentity(beacon: AgentHudBeacon): string {
  // The subagent messages too: their rows have no other source, and one that
  // came within the rewrite window of the last write was never stored when the
  // tab then went quiet (review of 2026-09-27).
  return `${beacon.agent}\u0000${beacon.sessionId ?? ''}\u0000${beacon.modelId ?? ''}\u0000${beacon.modelLabel ?? ''}\u0000${beacon.effort ?? ''}\u0000${agentMessagesIdentity(beacon.agentMessagePrompts)}`
}

const WARM_START_REWRITE_MS = 30_000
const lastStored = new Map<string, { identity: string; at: number }>()

function storeForWarmStart(handle: string, beacon: AgentHudBeacon): void {
  const identity = beaconIdentity(beacon)
  const previous = lastStored.get(handle)
  if (previous && previous.identity === identity && beacon.receivedAt - previous.at < WARM_START_REWRITE_MS) {
    return
  }
  lastStored.set(handle, { identity, at: beacon.receivedAt })
  void rememberWarmStartBeacon(handle, beacon)
}

/** Whether `next` comes from a different session than the one `previous`
 *  spoke for: a new process on the same terminal, or a `/clear` or `/resume`
 *  inside the old one. Nothing the previous session said applies to it. A
 *  beacon naming no session (a Codex notify whose argument named no thread)
 *  is taken to be the same process and merged as before. */
function sessionChanged(previous: AgentHudBeacon, next: AgentHudBeacon): boolean {
  return next.sessionId !== null && previous.sessionId !== null && next.sessionId !== previous.sessionId
}

/**
 * What the two hook frames add to the pair the status line states.
 *
 * Claude Code's `SessionStart` input names the model and carries no effort;
 * `Stop` carries the effort and no model (agent-hud-session-start-hook-script.ts
 * says where each fact was read). Neither frame carries the agent's own name
 * for the model, which only the status line sends (`name=`, always beside a
 * model). So:
 *  - a frame naming a model with no `name=` and no `effort=` is a SessionStart.
 *    For the SAME model it must not blank the name and effort the status line
 *    stated; for another model the old effort is that model's, so it goes.
 *  - a frame with an `effort=` and no model is a Stop. The effort is the
 *    session's now, whichever model is held, so it lands on the held pair. With
 *    no pair held it is kept without a model, and drawn by nobody until a
 *    model arrives: an effort alone says nothing about a model.
 * A status-line frame (it always carries `name=` with its model) is the whole
 * pair and replaces both, as before. The newest frame wins in every case.
 */
function pairFromHookFrame(
  previous: AgentHudBeacon,
  beacon: AgentHudBeacon
): Partial<AgentHudBeacon> {
  const namesModel = beacon.modelId !== null || beacon.modelLabel !== null
  if (!namesModel) {
    return beacon.effort === null ? {} : { effort: beacon.effort }
  }
  const sessionStart = beacon.modelLabel === null && beacon.effort === null
  if (sessionStart && (previous.modelId === beacon.modelId || previous.modelId === null)) {
    return { modelLabel: previous.modelLabel, effort: previous.effort }
  }
  return {}
}

function publish(handle: string, payload: string): void {
  const beacon = parseAgentHudBeaconPayload(payload)
  if (!beacon) {
    return
  }
  // Every arrival, repeats included: the process is painting.
  arrivals.set(handle, beacon.receivedAt)
  // Why merge: two beacons describe one tab. The status line says what the
  // agent IS (model, effort, context) on every repaint; the Stop hook says
  // what it still has RUNNING, and carries none of the rest. Replacing
  // wholesale would blank the HUD every time a turn ended.
  const held = beacons.get(handle)
  const previous = held && !sessionChanged(held, beacon) ? held : undefined
  // The prompt with when the phone received it, which tells a copy the chat
  // saw arrive from one it found long after (use-desktop-prompt-echoes.ts).
  const arrived = beacon.desktopPrompt && { ...beacon.desktopPrompt, seenAt: beacon.receivedAt }
  const joined: AgentHudBeacon = previous
    ? {
        ...previous,
        ...(beacon.modelId !== null || beacon.modelLabel !== null ? beacon : {}),
        ...pairFromHookFrame(previous, beacon),
        sessionId: beacon.sessionId ?? previous.sessionId,
        heartbeatSeconds: beacon.heartbeatSeconds ?? previous.heartbeatSeconds,
        runningTaskIds: beacon.runningTaskIds ?? previous.runningTaskIds,
        // Restamped only when the list moved: see `unchangedBeacon`.
        runningTaskIdsAt: restamp(beacon, previous),
        ...keepStopList(beacon, previous),
        doneTaskIds: beacon.doneTaskIds.length > 0 ? beacon.doneTaskIds : previous.doneTaskIds,
        launchedTaskIds:
          beacon.launchedTaskIds.length > 0 ? beacon.launchedTaskIds : previous.launchedTaskIds,
        // Prompts accumulate: each submission is its own beacon and the phone
        // must keep the ones that came before it.
        // Each stamped with its arrival (`arrived`, above).
        desktopPrompts: appendDesktopPrompt(previous.desktopPrompts, arrived),
        desktopPrompt: beacon.desktopPrompt ?? previous.desktopPrompt,
        promptHook: beacon.promptHook || previous.promptHook,
        receivedAt: beacon.receivedAt
      }
    : { ...beacon, desktopPrompts: appendDesktopPrompt([], arrived) }
  const merged = withAgentMessagesOf(handle, joined, previous === undefined, arrived)
  // A repeat says nothing new: keep the object readers already hold.
  if (previous && unchangedBeacon(previous, merged)) {
    return
  }
  beacons.set(handle, merged)
  storeForWarmStart(handle, merged)
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Bring back what each tab's agent last said about itself, for the window
 * between opening the app and the agent's next status-line repaint. A live
 * beacon always wins; this only fills a hole that would otherwise be filled by
 * a staler source. See `agent-hud-beacon-warm-start.ts`.
 *
 * A restored record is NOT an arrival: nothing has been heard from the
 * process this run, and the liveness rule counts from that.
 */
export async function hydrateAgentHudBeacons(): Promise<void> {
  const stored = await readWarmStartBeacons()
  let restored = false
  for (const [handle, beacon] of Object.entries(stored)) {
    if (!beacons.has(handle)) {
      beacons.set(handle, withRestoredAgentMessages(beacon, handle))
      restored = true
    }
  }
  if (restored) {
    for (const listener of listeners) {
      listener()
    }
  }
}

/**
 * Takes one raw output chunk for a terminal, keeps any beacons it carries, and
 * returns the bytes that should still reach the terminal view. Call it for
 * every `data` chunk, covered or not — it is the only place the payload
 * exists.
 */
export function consumeAgentHudBeacons(handle: string, chunk: string): string {
  // The channel first: its bytes can sit inside anything, an old OSC beacon
  // included, and once they are out every other byte is where it was.
  const taken = takeAgentHudChannelFor(handle, chunk)
  taken.payloads.forEach((payload) => publish(handle, payload))
  let text = (carries.get(handle) ?? '') + taken.text
  carries.delete(handle)
  let out = ''
  for (;;) {
    const start = text.indexOf(OSC_PREFIX)
    if (start === -1) {
      break
    }
    const bel = text.indexOf(BEL, start)
    const st = text.indexOf(ST, start + OSC_PREFIX.length)
    const useBel = bel !== -1 && (st === -1 || bel < st)
    const end = useBel ? bel : st
    if (end === -1) {
      // Still arriving: hold it back so the terminal never paints half a beacon.
      out += text.slice(0, start)
      const held = text.slice(start)
      if (held.length <= MAX_CARRY) {
        carries.set(handle, held)
        return out
      }
      // Too long to be one of ours; give the bytes back rather than eat them.
      return out + held
    }
    out += text.slice(0, start)
    publish(handle, text.slice(start + OSC_PREFIX.length, end))
    text = text.slice(end + (useBel ? BEL.length : ST.length))
  }
  const keep = splitPrefixLength(text)
  if (keep > 0) {
    carries.set(handle, text.slice(text.length - keep))
    return out + text.slice(0, text.length - keep)
  }
  return out + text
}

/** Records the row the chat drew a subagent message after, on the beacon of
 *  the terminal that carried it, and stores it: a restored message goes back
 *  there when its own row is one the phone never holds. */
export function rememberAgentMessagePlacement(handle: string, nonce: string, rowId: string): void {
  const beacon = beacons.get(handle)
  const placed = beacon && withAgentMessagePlaced(handle, beacon, nonce, rowId)
  if (placed && placed !== beacon) {
    beacons.set(handle, placed)
    storeForWarmStart(handle, placed)
    listeners.forEach((listener) => listener())
  }
}

export function getAgentHudBeacon(handle: string | null): AgentHudBeacon | null {
  return handle ? (beacons.get(handle) ?? null) : null
}

/** When a beacon last arrived on this handle THIS RUN (phone clock, epoch
 *  ms), or null: none has, which is also what a warm-start record reads as.
 *  Read from a timer or effect, never subscribed to — it moves on every
 *  repaint, and waking every reader for a repeat is the cost `unchangedBeacon`
 *  exists to avoid. */
export function getAgentHudBeaconArrivedAt(handle: string | null): number | null {
  return handle ? (arrivals.get(handle) ?? null) : null
}

/** Dropped with the rest of the terminal cache when the session's handles go
 *  away; a beacon outlives a mere unsubscribe, because the last thing the
 *  agent said about itself is still true while its tab is open. */
export function resetAgentHudBeacons(): void {
  beacons.clear()
  carries.clear()
  resetAgentHudChannels()
  arrivals.clear()
  resetBeaconWatches()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAgentHudBeacon(handle: string | null): AgentHudBeacon | null {
  return useSyncExternalStore(
    subscribe,
    () => getAgentHudBeacon(handle),
    () => null
  )
}

function liveOrRun(values: Map<string, string>): string[] | null {
  const key = values.has('live') ? 'live' : values.has('run') ? 'run' : null
  if (key === null) {
    return null
  }
  return (values.get(key) ?? '').split(',').filter((id) => /^[A-Za-z0-9_-]+$/.test(id))
}

const MAX_DESKTOP_PROMPTS = 40

/** Keeps each submission once, by the hook's own process id. */
export function appendDesktopPrompt(
  previous: readonly DesktopPrompt[],
  next: DesktopPrompt | null
): DesktopPrompt[] {
  if (!next || previous.some((prompt) => prompt.nonce === next.nonce)) {
    // The same array back: this runs on every status-line repaint, and a
    // fresh copy each time refolded the whole chat downstream (2026-09-13).
    return previous as DesktopPrompt[]
  }
  return [...previous, next].slice(-MAX_DESKTOP_PROMPTS)
}
