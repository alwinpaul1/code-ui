import { useSyncExternalStore } from 'react'
import {
  readWarmStartBeacons,
  rememberWarmStartBeacon
} from './agent-hud-beacon-warm-start'

/**
 * The phone half of the invisible HUD channel.
 *
 * Each agent writes `ESC ] 7777 ; CUIHUD1 key=value … BEL` straight to its own
 * PTY (see `agent-hud-launch-args.ts`). Terminals draw nothing for an unknown
 * OSC, so the user's screen is unchanged — but the phone already receives that
 * PTY byte stream, so it can sniff the sequence out, keep the payload, and
 * strip the bytes before anything reaches the WebView.
 *
 * OSC 7777 is in the private range. Anything else that looks like an OSC
 * (`ESC ] 0 ; title BEL`, for one) is passed through untouched.
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

export type AgentHudBeacon = {
  agent: string
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
  receivedAt: number
}

const beacons = new Map<string, AgentHudBeacon>()
const carries = new Map<string, string>()
const listeners = new Set<() => void>()

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
  return {
    agent,
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
  return `${beacon.agent}\u0000${beacon.modelId ?? ''}\u0000${beacon.modelLabel ?? ''}\u0000${beacon.effort ?? ''}`
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

function publish(handle: string, payload: string): void {
  const beacon = parseAgentHudBeaconPayload(payload)
  if (!beacon) {
    return
  }
  beacons.set(handle, beacon)
  storeForWarmStart(handle, beacon)
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Bring back what each tab's agent last said about itself, for the window
 * between opening the app and the agent's next status-line repaint. A live
 * beacon always wins; this only fills a hole that would otherwise be filled by
 * a staler source. See `agent-hud-beacon-warm-start.ts`.
 */
export async function hydrateAgentHudBeacons(): Promise<void> {
  const stored = await readWarmStartBeacons()
  let restored = false
  for (const [handle, beacon] of Object.entries(stored)) {
    if (!beacons.has(handle)) {
      beacons.set(handle, beacon)
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
  let text = (carries.get(handle) ?? '') + chunk
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

export function getAgentHudBeacon(handle: string | null): AgentHudBeacon | null {
  return handle ? (beacons.get(handle) ?? null) : null
}

/** Dropped with the rest of the terminal cache when the session's handles go
 *  away; a beacon outlives a mere unsubscribe, because the last thing the
 *  agent said about itself is still true while its tab is open. */
export function resetAgentHudBeacons(): void {
  beacons.clear()
  carries.clear()
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
