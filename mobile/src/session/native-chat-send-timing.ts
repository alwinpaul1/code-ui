import { connectionLogStore } from '../transport/persisted-connection-log-store'

/**
 * One line in the host's connection log (Settings → Connection log) for a composer send that was
 * slow (over NATIVE_CHAT_SLOW_SEND_MS), not sent, or not confirmed, with how long each stage
 * took, so a send the user found slow can be read back from the phone afterwards. A fast send the
 * desktop took writes nothing.
 *
 * Why: "sometimes a message takes too long to send" (2026-10-10) named no stage, and nothing on
 * the phone kept the timings. The stages are the ones a send actually waits on: the chips still
 * uploading, the wait for the link and the input lease (readiness), the look at the screen and the
 * heal before anything is typed, the terminal writes and the check that the agent took the words
 * (verify), a photo's paste and settle, and a structured session's mutation. The outbox write runs
 * beside the send, not in front of it, and is shown but never counted as what made it slow.
 *
 * Privacy: never the words or a file's contents. Only lengths, counts, timings and the tab.
 *
 * The stages are reported by the modules that wait (`noteSendStage`) into the send most recently
 * begun on this phone. A chat writes one send at a time per terminal (the write lock), so that
 * is the send doing the waiting; two structured sends tapped together could share their marks.
 */

export type NativeChatSendStage =
  | 'upload'
  | 'readiness'
  | 'look'
  | 'paste'
  | 'write'
  | 'verify'
  | 'mutation'
  | 'outbox'

/** Stages that run beside the send rather than in front of it. */
const PARALLEL: ReadonlySet<NativeChatSendStage> = new Set(['outbox'])
/** A send over this is "slow" and its line says which stage held it. */
export const NATIVE_CHAT_SLOW_SEND_MS = 3_000

type Timing = {
  id: number
  draftKey: string | null
  startedAt: number
  chars: number
  images: number
  stages: Map<NativeChatSendStage, number>
  path: string | null
  outcome: string | null
}

let nextId = 1
const open: Timing[] = []

export type NativeChatSendTiming = { readonly id: number }

/** At the tap: the scope key (host, worktree, tab) and the sizes, never the text. */
export function beginNativeChatSendTiming(
  draftKey: string | null,
  sizes: { chars: number; images?: number },
  now = Date.now()
): NativeChatSendTiming {
  const timing: Timing = {
    id: nextId++,
    draftKey,
    startedAt: now,
    chars: sizes.chars,
    images: sizes.images ?? 0,
    stages: new Map(),
    path: null,
    outcome: null
  }
  open.push(timing)
  return timing
}

function current(): Timing | undefined {
  return open.at(-1)
}

/** Adds `ms` to `stage` of the send in progress, if one is. */
export function noteSendStage(stage: NativeChatSendStage, ms: number): void {
  const timing = current()
  if (timing && Number.isFinite(ms) && ms >= 0) {
    timing.stages.set(stage, (timing.stages.get(stage) ?? 0) + ms)
  }
}

/** What `stage` of the send in progress has taken so far. */
export function sendStageMs(stage: NativeChatSendStage): number {
  return current()?.stages.get(stage) ?? 0
}

/** Times `run` as `stage` of the send in progress. */
export async function timeSendStage<T>(stage: NativeChatSendStage, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  try {
    return await run()
  } finally {
    noteSendStage(stage, Date.now() - startedAt)
  }
}

/** Which transport the send went out on: LAN, Tailscale, relay. */
export function noteSendPath(path: string | null | undefined): void {
  const timing = current()
  if (timing && path) {
    timing.path = path
  }
}

/** What the desktop answered: accepted, rejected, unknown (held for its row). */
export function noteSendOutcome(outcome: string): void {
  const timing = current()
  if (timing && timing.outcome === null) {
    timing.outcome = outcome
  }
}

/** The line a finished send leaves; exported for its test. */
export function describeNativeChatSendTiming(timing: {
  startedAt: number
  chars: number
  images: number
  stages: ReadonlyMap<NativeChatSendStage, number>
  path: string | null
  outcome: string | null
  draftKey: string | null
}, endedAt: number): { slow: boolean; dominant: NativeChatSendStage | null; detail: string } {
  const total = endedAt - timing.startedAt
  let dominant: NativeChatSendStage | null = null
  for (const [stage, ms] of timing.stages) {
    if (!PARALLEL.has(stage) && (dominant === null || ms > (timing.stages.get(dominant) ?? 0))) {
      dominant = stage
    }
  }
  const slow = total > NATIVE_CHAT_SLOW_SEND_MS
  const parts = [
    `total ${total} ms${slow && dominant ? ` (slow: ${dominant} ${timing.stages.get(dominant)} ms)` : ''}`,
    ...[...timing.stages].map(([stage, ms]) => `${stage} ${ms} ms`),
    `via ${timing.path ?? 'unknown'}`,
    `${timing.chars} chars`,
    ...(timing.images > 0 ? [`${timing.images} attachment(s)`] : []),
    `tab ${timing.draftKey?.split('\0').at(-1) ?? 'none'}`
  ]
  return { slow, dominant, detail: parts.join(' · ') }
}

/** Ends the send and writes its line to its host's connection log, when it has one (slow, refused or unconfirmed). */
export function finishNativeChatSendTiming(handle: NativeChatSendTiming, outcome?: string, now = Date.now()): void {
  const index = open.findIndex((timing) => timing.id === handle.id)
  if (index === -1) {
    return
  }
  const [timing] = open.splice(index, 1)
  if (!timing) {
    return
  }
  const hostId = timing.draftKey?.split('\0')[0]
  if (!hostId) {
    return
  }
  const said = timing.outcome ?? outcome ?? 'unknown'
  const { slow, detail } = describeNativeChatSendTiming(timing, now)
  // A fast send the desktop took leaves nothing: the log keeps 200 entries per host and is saved
  // whole on each append, so a line per send pushed the connection events this screen exists for
  // out after about 200 sends, and cost every send a full save (0.9.127).
  if (!slow && said === 'accepted') {
    return
  }
  connectionLogStore.append(hostId, {
    id: `chat-send-${timing.startedAt}-${timing.id}`,
    ts: now,
    level: slow || said === 'rejected' ? 'warn' : 'info',
    code: 'chat-send-timing',
    message: said === 'accepted' ? 'Message sent' : said === 'rejected' ? 'Message not sent' : 'Message held until the desktop shows it',
    detail
  })
}

/** Times a whole composer send from its tap and, when it settles slow or not sent, writes its line. */
export async function withNativeChatSendTiming(
  draftKey: string | null,
  sizes: { chars: number; images?: number },
  send: () => Promise<boolean>
): Promise<boolean> {
  const timing = beginNativeChatSendTiming(draftKey, sizes)
  let sent = false
  try {
    sent = await send()
    return sent
  } finally {
    finishNativeChatSendTiming(timing, sent ? 'accepted' : 'rejected')
  }
}

/** The terminal writes of one send, timed apart from the check that the agent took the words
 *  (that check notes its own `verify` time from inside), with what the desktop answered. */
export async function timeSendWrites<T extends { kind: 'stopped' } | { kind: string; outcome: string }>(
  timed: boolean,
  write: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()
  const verifiedBefore = sendStageMs('verify')
  const written = await write()
  if (timed) {
    noteSendStage('write', Date.now() - startedAt - (sendStageMs('verify') - verifiedBefore))
    noteSendOutcome('outcome' in written ? written.outcome : 'rejected')
  }
  return written
}

/** Test-only: sends begun in one test must not take marks in the next. */
export function resetNativeChatSendTimingForTests(): void {
  open.length = 0
}
