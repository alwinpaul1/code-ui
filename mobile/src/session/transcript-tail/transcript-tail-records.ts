// ─── The agent's own transcript, read live, one JSONL row at a time ──────────
//
// Claude Code writes every session to `~/.claude/projects/<slug>/<id>.jsonl`
// as it happens. Orca's reader turns the `user`/`assistant` rows of that file
// into the chat the phone shows and drops the rest — and the rest is where a
// hand-started session keeps what the phone was missing (2026-09-19):
//
//   - a message submitted while a turn runs, from ANY client (the desktop, the
//     Claude app over its bridge, another phone), lands as a `queue-operation`
//     `enqueue` and, once the turn takes it, an `attachment` of type
//     `queued_command` with `origin.kind: "human"` — never as a user row;
//   - the queue itself is the `enqueue`/`remove`/`dequeue` operations;
//   - a tool call is an `assistant` row with a `tool_use` block, written the
//     moment the call starts, and its `tool_result` is a later `user` row —
//     between the two the call is running.
//
// So the phone tails the file through a background host terminal (see
// `transcript-tail-session.ts`) and reads those rows here. Verified against
// Claude Code 2.1.277 on 2026-09-19; the fixtures are rows of this machine's
// own transcript, verbatim.
//
// Rows arrive capped at `TAIL_ROW_MAX_CHARS` (the tail command cuts them), so
// a row carrying a pasted image (hundreds of KB of base64) is cut mid-string
// and does not parse. The text of such a prompt sits BEFORE the image in the
// record, so it is read back out of the cut row by shape; everything else in a
// cut row is given up on.

export type TranscriptTailRecord =
  | {
      kind: 'queued-prompt'
      uuid: string
      /** The transcript row that was last when the prompt was submitted: where
       *  the message belongs in the conversation. */
      parentUuid: string | null
      text: string
      at: number | null
    }
  | {
      kind: 'queue-op'
      op: 'enqueue' | 'remove' | 'dequeue'
      /** Absent on a `dequeue`: Claude takes the whole queue as its next
       *  turn and names nothing (verified 2026-09-19: a phone send after an
       *  interrupt, then "Send now"). */
      content: string | null
      at: number | null
    }
  | {
      kind: 'tool-use'
      uuid: string
      calls: { id: string; name: string; input: unknown }[]
      at: number | null
    }
  | { kind: 'tool-result'; ids: string[]; at: number | null }
  /** A person's own turn (typed while idle): whatever was running is over. */
  | { kind: 'user-turn' }
  | { kind: 'other' }

/** Each row the tail command lets through is at most this long. Above it a
 *  row is one Claude wrote with an image or a very long tool input; the tail
 *  cuts it so the terminal stream carries one row per line and the relay is
 *  not asked to move a screenshot's base64 for a message the phone will show
 *  as text. Under the runtime's own chunking (~32 KB per stream row, measured
 *  2026-09-19), so a cut row is never split again. */
export const TAIL_ROW_MAX_CHARS = 24_000

function timestampOf(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }
  const at = Date.parse(value)
  return Number.isFinite(at) ? at : null
}

function promptText(prompt: unknown): string | null {
  if (typeof prompt === 'string') {
    return prompt
  }
  if (!Array.isArray(prompt)) {
    return null
  }
  const parts: string[] = []
  for (const block of prompt) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function readParsed(record: Record<string, unknown>): TranscriptTailRecord {
  const type = record.type
  const at = timestampOf(record.timestamp)
  if (type === 'queue-operation') {
    const op = record.operation
    const content = typeof record.content === 'string' ? record.content : null
    if (op === 'enqueue' && content !== null) {
      return { kind: 'queue-op', op, content, at }
    }
    if (op === 'remove' || op === 'dequeue') {
      return { kind: 'queue-op', op, content, at }
    }
    return { kind: 'other' }
  }
  if (type === 'attachment') {
    const attachment = record.attachment
    if (!attachment || typeof attachment !== 'object') {
      return { kind: 'other' }
    }
    const a = attachment as Record<string, unknown>
    if (a.type !== 'queued_command') {
      return { kind: 'other' }
    }
    // Only what a person typed. Claude also queues its own follow-ups (a
    // task notification, a hook's injected text) through the same record.
    const origin = a.origin as { kind?: unknown } | undefined
    if (origin?.kind !== 'human' && a.humanTurn !== true) {
      return { kind: 'other' }
    }
    const text = promptText(a.prompt)
    const uuid = record.uuid
    if (text === null || typeof uuid !== 'string' || !uuid) {
      return { kind: 'other' }
    }
    const parentUuid = typeof record.parentUuid === 'string' ? record.parentUuid : null
    return { kind: 'queued-prompt', uuid, parentUuid, text, at: timestampOf(a.timestamp) ?? at }
  }
  const message = record.message as { role?: unknown; content?: unknown } | undefined
  const content = Array.isArray(message?.content) ? message.content : null
  if (type === 'assistant' && content) {
    const calls: { id: string; name: string; input: unknown }[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown }
      if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        calls.push({ id: b.id, name: b.name, input: b.input })
      }
    }
    const uuid = record.uuid
    if (calls.length > 0 && typeof uuid === 'string') {
      return { kind: 'tool-use', uuid, calls, at }
    }
    return { kind: 'other' }
  }
  if (type === 'user') {
    if (typeof message?.content === 'string') {
      return record.isMeta === true ? { kind: 'other' } : { kind: 'user-turn' }
    }
    if (!content) {
      return { kind: 'other' }
    }
    const ids: string[] = []
    let text = false
    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const b = block as { type?: unknown; tool_use_id?: unknown }
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        ids.push(b.tool_use_id)
      } else if (b.type === 'text' || b.type === 'image') {
        text = true
      }
    }
    if (ids.length > 0) {
      return { kind: 'tool-result', ids, at }
    }
    return text && record.isMeta !== true ? { kind: 'user-turn' } : { kind: 'other' }
  }
  return { kind: 'other' }
}

/** A JSON string literal's body (between the quotes), unescaped. */
function unescapeJsonString(body: string): string | null {
  try {
    return JSON.parse(`"${body}"`) as string
  } catch {
    return null
  }
}

const CUT_QUEUED_PROMPT =
  /"attachment":\{"type":"queued_command","prompt":\[\{"type":"text","text":"((?:[^"\\]|\\.)*)"/
const CUT_UUID = /"uuid":"([0-9a-f-]{36})"/
const CUT_PARENT = /"parentUuid":"([0-9a-f-]{36})"/
const CUT_TOOL_USE = /"type":"tool_use","id":"(toolu_[A-Za-z0-9]+)","name":"([A-Za-z_][\w.-]*)"/g
const CUT_TOOL_RESULT = /"tool_use_id":"(toolu_[A-Za-z0-9]+)","type":"tool_result"|"type":"tool_result","tool_use_id":"(toolu_[A-Za-z0-9]+)"/g

/** A short stable digest, for a nonce when the row's own uuid was cut away. */
function digest(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16)
}

/** What can still be read off a row the tail command cut. Claude writes a
 *  record's `uuid`, `origin` and `timestamp` AFTER its payload, so on a cut
 *  row they are gone: a queued prompt keeps its text (it comes before its
 *  images) and is keyed by the row it hangs off plus a digest of the text; a
 *  tool call keeps its id and name (they come before its input). Both are
 *  read by shape, only when the row's head says what it is. */
function readCut(row: string): TranscriptTailRecord {
  if (!row.startsWith('{"parentUuid"') && !row.startsWith('{"type"') && !row.startsWith('{"uuid"')) {
    return { kind: 'other' }
  }
  const prompt = CUT_QUEUED_PROMPT.exec(row)
  if (prompt) {
    const text = unescapeJsonString(prompt[1]!)
    if (text !== null) {
      const parentUuid = CUT_PARENT.exec(row)?.[1] ?? null
      return {
        kind: 'queued-prompt',
        uuid: CUT_UUID.exec(row)?.[1] ?? `cut:${parentUuid ?? ''}:${digest(text)}`,
        parentUuid,
        text,
        at: null
      }
    }
  }
  if (row.includes('"role":"assistant"')) {
    const calls: { id: string; name: string; input: unknown }[] = []
    for (const match of row.matchAll(CUT_TOOL_USE)) {
      calls.push({ id: match[1]!, name: match[2]!, input: undefined })
    }
    if (calls.length > 0) {
      return { kind: 'tool-use', uuid: CUT_UUID.exec(row)?.[1] ?? calls[0]!.id, calls, at: null }
    }
  }
  // A result too long to fit (a big grep, a test run's output) is cut inside
  // its content; its id comes first. Without this the call it answers stayed
  // live for good (review, 2026-09-19).
  if (row.includes('"role":"user"')) {
    const ids: string[] = []
    for (const match of row.matchAll(CUT_TOOL_RESULT)) {
      ids.push(match[1] ?? match[2]!)
    }
    if (ids.length > 0) {
      return { kind: 'tool-result', ids, at: null }
    }
  }
  return { kind: 'other' }
}

/** One stream row from the tail terminal. Blank rows and the shell's own
 *  output are `other`. */
export function readTranscriptTailRow(row: string): TranscriptTailRecord {
  const trimmed = row.trim()
  if (!trimmed.startsWith('{')) {
    return { kind: 'other' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return readCut(trimmed)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'other' }
  }
  return readParsed(parsed as Record<string, unknown>)
}

export type TranscriptTailPrompt = {
  /** The record's uuid: distinct per submission, stable across re-reads. */
  nonce: string
  text: string
  anchorId: string | null
  at: number | null
}

export type TranscriptTailLiveCall = {
  id: string
  name: string
  input: unknown
  startedAt: number | null
}

export type TranscriptTailState = {
  prompts: readonly TranscriptTailPrompt[]
  /** Messages Claude holds for the next turn, oldest first. */
  queue: readonly string[]
  /** The most recent tool call with no result yet, or null. */
  liveCall: TranscriptTailLiveCall | null
  /** Every started call with no result yet, by id, in start order. */
  pendingCalls: readonly TranscriptTailLiveCall[]
}

export const EMPTY_TRANSCRIPT_TAIL_STATE: TranscriptTailState = {
  prompts: [],
  queue: [],
  liveCall: null,
  pendingCalls: []
}

/** How many prompts are kept. Older ones have long since landed as rows. */
const PROMPT_CAP = 64

export function reduceTranscriptTail(
  state: TranscriptTailState,
  record: TranscriptTailRecord
): TranscriptTailState {
  switch (record.kind) {
    case 'queued-prompt': {
      if (state.prompts.some((prompt) => prompt.nonce === record.uuid)) {
        return state
      }
      const prompts = [
        ...state.prompts,
        { nonce: record.uuid, text: record.text, anchorId: record.parentUuid, at: record.at }
      ].slice(-PROMPT_CAP)
      // Taken by the turn: it is no longer queued, whatever the queue
      // operations said (a `remove` normally precedes this record).
      const queue = withoutFirst(state.queue, record.text)
      return { ...state, prompts, queue }
    }
    case 'queue-op': {
      if (record.op === 'enqueue') {
        return { ...state, queue: [...state.queue, record.content ?? ''] }
      }
      // No content: the whole queue went, as the next turn. A phantom entry
      // sat in the queue box for good before this (device, 2026-09-19).
      if (record.content === null) {
        return state.queue.length === 0 ? state : { ...state, queue: [] }
      }
      return { ...state, queue: withoutFirst(state.queue, record.content) }
    }
    case 'tool-use': {
      const pendingCalls = [
        ...state.pendingCalls,
        ...record.calls.map((call) => ({ ...call, startedAt: record.at }))
      ]
      return { ...state, pendingCalls, liveCall: pendingCalls[pendingCalls.length - 1] ?? null }
    }
    case 'tool-result': {
      const done = new Set(record.ids)
      const pendingCalls = state.pendingCalls.filter((call) => !done.has(call.id))
      if (pendingCalls.length === state.pendingCalls.length) {
        return state
      }
      return { ...state, pendingCalls, liveCall: pendingCalls[pendingCalls.length - 1] ?? null }
    }
    case 'user-turn': {
      // A person's turn began: nothing was running, and whatever was queued
      // is this turn now.
      if (state.pendingCalls.length === 0 && state.queue.length === 0) {
        return state
      }
      return { ...state, pendingCalls: [], liveCall: null, queue: [] }
    }
    case 'other':
      return state
    default: {
      const exhaustive: never = record
      return exhaustive
    }
  }
}

function withoutFirst(queue: readonly string[], content: string): readonly string[] {
  const index = queue.indexOf(content)
  if (index === -1) {
    return queue
  }
  return [...queue.slice(0, index), ...queue.slice(index + 1)]
}
