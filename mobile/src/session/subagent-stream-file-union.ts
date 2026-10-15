import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * A subagent's rows as the Agent sheet and its transcript viewer draw them: Orca's file is the
 * baseline, and Anthropic's stream adds what the file does not hold yet.
 *
 * The stream alone undercounts. The tab's store drops undrawn events past
 * `CCR_HELD_UNDRAWN_EVENTS` (ccr-link-store.ts), and a subagent's own events never draw a row in
 * the lead's chat, so a long agent keeps only its newest calls there (review 2026-10-15: one
 * streamed call against four in the file read "Tool calls (1)"). The file is a window too: its
 * feed reads the newest 40 messages (`INITIAL_LIMIT`, use-mobile-native-chat-session.ts), so the
 * stream can hold rows older than the file's first one.
 *
 * The two sources share their keys: a streamed row's id is the event's `uuid`, which is the
 * transcript line's `uuid`, and a tool call or result carries its `tool_use_id` as `callId` in
 * both. A streamed row whose id the file already holds is dropped whole; otherwise each tool call
 * or result the file already holds is dropped from it, and a row left with no blocks goes. Two
 * keys differ between the decoders and are matched here: a thinking-only line is `uuid` in Orca's
 * and `${uuid}:thinking` in ccr-transcript-decode.ts, and an event with no `uuid` takes its
 * `eventId` (see `noteStreamRowWithoutUuid`).
 *
 * The rows come back in time order (see `mergeByTime`), never as the file followed by the stream:
 * that drew older streamed calls after newer file ones, and left the call whose result opened the
 * file's window at the end, where it paired with nothing and was counted twice (review
 * 2026-10-15: three calls read "Tool calls (4+)").
 */
export function unionSubagentMessages(file: readonly NativeChatMessage[], streamed: readonly NativeChatMessage[]): NativeChatMessage[] {
  return subagentStreamFileUnion(file, streamed).messages
}

export type SubagentStreamFileUnion = {
  messages: NativeChatMessage[]
  /** Whether the stream held anything the file did not: the file is then behind, and a count over
   *  the union is a floor, never exact. */
  streamAdded: boolean
}

export function subagentStreamFileUnion(file: readonly NativeChatMessage[], streamed: readonly NativeChatMessage[]): SubagentStreamFileUnion {
  if (streamed.length === 0) {
    return { messages: [...file], streamAdded: false }
  }
  const ids = new Set(file.map((message) => message.id))
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const block of file.flatMap((message) => message.blocks)) {
    if (block.type === 'tool-call' && block.callId) {
      calls.add(block.callId)
    } else if (block.type === 'tool-result' && block.callId) {
      results.add(block.callId)
    }
  }
  const held = (block: NativeChatBlock): boolean =>
    (block.type === 'tool-call' && !!block.callId && calls.has(block.callId)) ||
    (block.type === 'tool-result' && !!block.callId && results.has(block.callId))
  const fileTexts = new Set(file.flatMap((message) => textKey(message) ?? []))
  const extra: NativeChatMessage[] = []
  for (const message of streamed) {
    if (ids.has(message.id) || (message.id.endsWith(THINKING_SUFFIX) && ids.has(message.id.slice(0, -THINKING_SUFFIX.length)))) {
      continue
    }
    // Only a row that had no uuid to match by, and only on the same text, role and time: a row
    // that carries its uuid is the file's only when the ids agree.
    if (uuidless.has(message) && fileTexts.has(textKey(message) ?? '')) {
      continue
    }
    const blocks = message.blocks.filter((block) => !held(block))
    if (blocks.length === message.blocks.length) {
      extra.push(message)
    } else if (blocks.length > 0) {
      extra.push({ ...message, blocks })
    }
  }
  return { messages: mergeByTime(file, extra), streamAdded: extra.length > 0 }
}

const THINKING_SUFFIX = ':thinking'

const uuidless = new WeakSet<NativeChatMessage>()

/** A streamed row decoded from an event with no `payload.uuid`: its id is the event's `eventId`,
 *  which the file's line never carries, so the union matches it by its text instead. */
export function noteStreamRowWithoutUuid(row: NativeChatMessage): void {
  uuidless.add(row)
}

/** A text-only row's role, time and text, or null for a row that holds anything else. */
function textKey(message: NativeChatMessage): string | null {
  if (message.blocks.length === 0 || message.timestamp === null || !message.blocks.every((block) => block.type === 'text')) {
    return null
  }
  return JSON.stringify([message.role, message.timestamp, message.blocks.map((block) => (block.type === 'text' ? block.text : ''))])
}

/**
 * The two sources merged by time, each kept in its own order. A row with no timestamp takes the
 * time of the row before it in its own source, so it stays beside that row. On a tie the file's
 * row goes first. A row holding a tool result never goes out before the other source's row
 * holding its call, whatever the clocks say: the two sources stamp from different clocks, and a
 * result ahead of its call pairs with nothing (`pairToolBlocks`).
 */
function mergeByTime(file: readonly NativeChatMessage[], stream: readonly NativeChatMessage[]): NativeChatMessage[] {
  if (stream.length === 0) {
    return [...file]
  }
  if (file.length === 0) {
    return [...stream]
  }
  const fileTimes = carriedTimes(file)
  const streamTimes = carriedTimes(stream)
  const fileCalls = callIndex(file)
  const streamCalls = callIndex(stream)
  // Whether `row` answers a call the other source has not put out yet (its index is `next` or later).
  const waits = (row: NativeChatMessage, otherCalls: ReadonlyMap<string, number>, next: number): boolean =>
    row.blocks.some((block) => block.type === 'tool-result' && !!block.callId && (otherCalls.get(block.callId) ?? -1) >= next)
  const merged: NativeChatMessage[] = []
  let f = 0
  let s = 0
  while (f < file.length && s < stream.length) {
    const fileRow = file[f]!
    const streamRow = stream[s]!
    let takeStream = streamTimes[s]! < fileTimes[f]!
    if (takeStream ? waits(streamRow, fileCalls, f) && !waits(fileRow, streamCalls, s) : waits(fileRow, streamCalls, s) && !waits(streamRow, fileCalls, f)) {
      takeStream = !takeStream
    }
    if (takeStream) {
      merged.push(streamRow)
      s += 1
    } else {
      merged.push(fileRow)
      f += 1
    }
  }
  merged.push(...file.slice(f), ...stream.slice(s))
  return merged
}

function carriedTimes(rows: readonly NativeChatMessage[]): number[] {
  let last = Number.NEGATIVE_INFINITY
  return rows.map((row) => (last = row.timestamp ?? last))
}

function callIndex(rows: readonly NativeChatMessage[]): Map<string, number> {
  const index = new Map<string, number>()
  rows.forEach((row, at) => {
    for (const block of row.blocks) {
      if (block.type === 'tool-call' && block.callId && !index.has(block.callId)) {
        index.set(block.callId, at)
      }
    }
  })
  return index
}
