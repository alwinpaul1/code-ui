import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { rememberProbedSessionCommandPair, sessionCommandPair, type SessionCommandPair } from './claude-session-command-pair'
import { peekClaudeTranscriptModel } from './claude-transcript-model-scan'
import { nativeChatSessionPageRead } from './mobile-session-read-operations'

/**
 * The session's own last answer to `/model`, `/effort` or `/fast`, looked for
 * further back in its transcript than the chat has loaded.
 *
 * The chat loads the last 40 rows (Orca's `MOBILE_NATIVE_CHAT_DEFAULT_WINDOW`),
 * and a session's `/effort` is usually typed long before them. With no beacon,
 * no badge and no spinner on screen, the pills then said "Opus 5.5" with no
 * effort although the transcript held Claude Code's own "Set effort level to
 * medium" (reported 2026-10-11: "read the effort from the transcript"). This
 * reads the session's own file backwards through `nativeChat.readSession`, the
 * same Orca read the chat pages older history with (no terminal, nothing on the
 * host), and hands the newest pair it finds to the command-pair memory
 * (claude-session-command-pair.ts), where it is tier 3 like a row the chat
 * loaded: below the live pair and the screen, above the startup frame and the
 * scan (docs/mobile-agent-hud.md, "Model and effort without a beacon").
 *
 * Bounded: pages of `EFFORT_PROBE_PAGE` rows, at most `EFFORT_PROBE_MAX_PAGES`,
 * once per session per app run. A session that has never had its effort set by
 * a command has nothing to find (Claude Code 2.1.296 writes no effort into any
 * other record), and the pills keep showing none: no figure is invented.
 * A failed read is tried again on the next NEW connection only
 * (CLAUDE.md, "Nothing stays stale once the relay connects").
 */
export const EFFORT_PROBE_PAGE = 200
export const EFFORT_PROBE_MAX_PAGES = 10

export type ProbePageParams = { limit: number; beforeOffset?: number }
/** One `nativeChat.readSession` page: resolves to the accepted payload, or
 *  throws with the reason it was refused. */
export type ProbePageRead = (params: ProbePageParams) => Promise<unknown>

export type ProbeOutcome =
  | { kind: 'found'; pair: SessionCommandPair }
  | { kind: 'none'; reason: 'searched-whole-transcript' | 'page-budget-spent' }
  | { kind: 'failed'; reason: string }

type Page = { messages: NativeChatMessage[]; hasMore: boolean; beforeOffset: number | null }

function readPage(payload: unknown): Page | string {
  if (payload === null || typeof payload !== 'object') {
    return 'the reply carried no page'
  }
  const record = payload as Record<string, unknown>
  if (typeof record.error === 'string') {
    return `the host answered: ${record.error}`
  }
  if (!Array.isArray(record.messages)) {
    return 'the reply carried no message list'
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the host's own NativeChatMessage rows; sessionCommandPair reads only role, blocks and timestamp, and skips a row it cannot read.
    messages: record.messages as NativeChatMessage[],
    hasMore: record.hasMore === true,
    beforeOffset: typeof record.beforeOffset === 'number' ? record.beforeOffset : null
  }
}

/**
 * Walk the transcript back from its end until a page holds a command pair.
 * The rows read so far are kept, older first, so a `/effort` whose envelope
 * ends one page and whose answer opens the next is still read as one; the
 * newest pair in them wins (sessionCommandPair keeps the last).
 */
export async function walkTranscriptForCommandPair(read: ProbePageRead): Promise<ProbeOutcome> {
  // Pages older first, as the rows are read.
  const pages: NativeChatMessage[][] = []
  const seen = new Set<string>()
  let beforeOffset: number | undefined
  for (let index = 0; index < EFFORT_PROBE_MAX_PAGES; index += 1) {
    let payload: unknown
    try {
      payload = await read({ limit: EFFORT_PROBE_PAGE, ...(beforeOffset === undefined ? {} : { beforeOffset }) })
    } catch (error) {
      return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    const page = readPage(payload)
    if (typeof page === 'string') {
      return { kind: 'failed', reason: page }
    }
    const fresh = page.messages.filter((row) => !seen.has(row.id))
    for (const row of fresh) {
      seen.add(row.id)
    }
    pages.unshift(fresh)
    const pair = sessionCommandPair(pages.flat())
    if (pair !== null) {
      return { kind: 'found', pair }
    }
    // An older host ignores the cursor and answers no offset: one page is all
    // it can give. An offset that does not move would read the same page again.
    if (!page.hasMore || page.beforeOffset === null || page.beforeOffset === beforeOffset || page.beforeOffset <= 0) {
      return { kind: 'none', reason: 'searched-whole-transcript' }
    }
    beforeOffset = page.beforeOffset
  }
  return { kind: 'none', reason: 'page-budget-spent' }
}

type ProbeState = { status: 'running' | 'found' | 'none' | 'failed'; connection: number | null }

const probes = new Map<string, ProbeState>()
const listeners = new Set<() => void>()

const keyFor = (hostId: string, sessionId: string): string => `${hostId}\u0000${sessionId}`

export function subscribeTranscriptEffortProbes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetTranscriptEffortProbesForTests(): void {
  probes.clear()
  listeners.clear()
}

/**
 * Look for this session's command pair once. A probe already run, running or
 * found stays as it is; a failed one runs again only on a NEW connection. The
 * result is filed under the session it was asked for and no other, so a tab
 * that has moved on to another session meanwhile cannot be handed it.
 */
export function requestTranscriptEffortProbe(args: {
  client: RpcClient
  hostId: string
  sessionId: string
  transcriptPath: string | null
  connection: number | null
  /** The model the scan read when the probe was asked for. An effort-only
   *  pair is bound to the scan's model when the pair is FILED (the scan has
   *  often answered by then on a cold open), else to this, as a loaded row's
   *  is bound when first seen (sessionCommandPairFor). */
  boundModel: string | null
}): void {
  const { client, hostId, sessionId, transcriptPath, connection, boundModel } = args
  const key = keyFor(hostId, sessionId)
  const held = probes.get(key)
  if (held && (held.status !== 'failed' || held.connection === connection)) {
    return
  }
  const state: ProbeState = { status: 'running', connection }
  probes.set(key, state)
  const read: ProbePageRead = async (params) => {
    const response = await nativeChatSessionPageRead.request(client, {
      agent: 'claude',
      sessionId,
      ...params,
      ...(transcriptPath ? { transcriptPath } : {})
    })
    const accepted = nativeChatSessionPageRead.interpret(response)
    if (!accepted.accepted) {
      throw new Error('the host refused nativeChat.readSession')
    }
    return accepted.value
  }
  void walkTranscriptForCommandPair(read).then((outcome) => {
    if (probes.get(key) !== state) {
      return
    }
    state.status = outcome.kind
    if (outcome.kind === 'failed') {
      console.warn(
        `[claude-effort] could not read session ${sessionId} on host ${hostId} for its /model or /effort answer: ${outcome.reason}; asking again on the next connection`
      )
      return
    }
    if (outcome.kind === 'found' && rememberProbedSessionCommandPair(sessionId, outcome.pair, peekClaudeTranscriptModel(hostId, sessionId)?.model ?? boundModel)) {
      for (const listener of Array.from(listeners)) {
        listener()
      }
    }
  })
}
