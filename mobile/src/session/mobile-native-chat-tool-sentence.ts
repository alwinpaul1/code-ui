import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { isToolCallBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { createCodexPollFolder } from './codex-stdin-poll'
import { editedFileCount, type ToolRunPair } from './mobile-native-chat-edited-files'
import { toolCallKind } from './mobile-native-chat-tool-kind'
import {
  describedAgentRunWords,
  soleCallWords,
  TOOL_SUMMARY_WORDS,
  toolSummaryKind,
  type ToolSummaryKind as Kind
} from './mobile-native-chat-tool-run-words'

export { toolCallKind }

/**
 * One plain sentence for a run of tool calls, in the Claude app's words: "Ran 3
 * commands, read a file", "Ran 12 commands (2 failed), read 6 files", "Searched
 * code, found files", and for a run of ONE call its verb and target: "Ran
 * <description>", "Edited parser.ts", "Ran skill /unslop", "Messaged @agent
 * <summary or message>". The categories, their words and the one-call targets
 * are the app's (mobile-native-chat-tool-run-words.ts, Claude Android
 * 1.261013.20). Requested 2026-09-12 in place of "20× Bash cd … +17 more";
 * brought to the app's whole table 2026-10-15. Tool names are grouped by what
 * they did to the reader, not by the agent's vocabulary, so Claude's `Bash` and
 * Codex's `shell`, `local_shell`, `exec_command`, `shell_command` and
 * `write_stdin` all read as commands — a `write_stdin` that only polls a
 * command already counted folding into it (codex-stdin-poll.ts).
 */

/** The most categories one sentence names (the app's summary builder): with
 *  more, those with failures are taken first, then the rest, and the first
 *  this many of that list are drawn, in run order. */
export const TOOL_SENTENCE_MAX_CATEGORIES = 3

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Longest SendMessage preview the row is given. The row draws one line and
 *  ellipsizes it natively; this only keeps a long message out of text
 *  layout, and is wide enough to fill a tablet row first. */
export const SEND_MESSAGE_PREVIEW_MAX = 200

function firstText(input: Record<string, unknown> | null, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input?.[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return null
}

/** Who a SendMessage went to, as the agent wrote it: a teammate's name or an
 *  agent id. `to` first, then `recipient`; the 2026-09-26 call carried both
 *  with the same id, the 2026-09-24 ones `to` alone. Null when neither names
 *  anyone. */
function sendMessageRecipient(input: unknown): string | null {
  return firstText(record(input), ['to', 'recipient'])?.trim() ?? null
}

/** How the row and the sheet title name a SendMessage's recipient: "@name"
 *  for a teammate or an agent id, with one @ however the agent wrote it;
 *  "everyone" for a broadcast (`*`); "another session" for a message to a
 *  different Claude Code session's inbox (`uds:<socket path>`), whose path
 *  would fill the row. Null when the call names no one (review of a91c04d1). */
export function sendMessageAddressee(input: unknown): string | null {
  const raw = sendMessageRecipient(input)
  if (!raw) {
    return null
  }
  if (raw === '*') {
    return 'everyone'
  }
  if (/^uds:/i.test(raw)) {
    return 'another session'
  }
  const name = raw.replace(/^@+/, '').trim()
  return name ? `@${name}` : null
}

/** SendMessage's recipient plus a one-line preview: its `summary` when it has
 *  one (the Claude app's row, 2026-09-24, checked against real `SendMessage`
 *  tool_use records in local Claude Code transcripts), else the `message`
 *  itself, else `content`. The 2026-09-26 call, seen in the sheet's Inputs
 *  list and the Claude app's row, had no summary and a `content` already cut
 *  ("…read of the fra..."), so the full `message` comes first. */
export function sendMessageDetail(block: NativeChatBlock): { to: string; preview: string | null } | null {
  if (!isToolCallBlock(block) || toolCallKind(block.name) !== 'message') {
    return null
  }
  const to = sendMessageAddressee(block.input)
  if (!to) {
    return null
  }
  const text = firstText(record(block.input), ['summary', 'message', 'content'])
  if (!text) {
    return { to, preview: null }
  }
  // Counted and cut in code points, so the cut never splits an emoji's
  // surrogate pair into a stray half.
  const line = Array.from(text.replace(/\s+/g, ' ').trim())
  const preview =
    line.length > SEND_MESSAGE_PREVIEW_MAX
      ? `${line.slice(0, SEND_MESSAGE_PREVIEW_MAX).join('')}…`
      : line.join('')
  return { to, preview }
}

type Group = {
  kind: Kind
  failed: number
  /** Every call of this kind, in run order, each with its result once one
   *  arrives. A lone call is asked for its own label (file name, command
   *  description), whether it created a file, or a SendMessage's recipient
   *  and text; none of those has one answer for a group. */
  pairs: ToolRunPair[]
}

function runGroups(blocks: readonly NativeChatBlock[]): Group[] {
  const groups: Group[] = []
  const indexByKind = new Map<Kind, number>()
  // A Codex poll of a command already counted counts as no call, and its result is then no
  // group's (codex-stdin-poll.ts). A poll's error is left to the run header's own "N failed"
  // label: given the run's count, a sentence that counts fewer states none (buildSentence).
  const foldsIntoCommand = createCodexPollFolder()
  // Results pair with calls by the fold's own rule (`pairToolBlocks`), so the sentence counts a
  // failure against the call the rows draw it on: a result that names its call (`callId`, which a
  // structured chat's results carry since Orca #22619) answers that call, and one that names none
  // the oldest call not yet answered. First-in-first-out here gave a fast-failing call's result
  // to an earlier call still running ("Ran a command (1 failed), edited a file").
  for (const { call, result } of pairToolBlocks(blocks)) {
    if (!call || foldsIntoCommand(call.name, call.input)) {
      continue
    }
    const kind = toolSummaryKind(call.name)
    let index = indexByKind.get(kind)
    if (index === undefined) {
      index = groups.length
      indexByKind.set(kind, index)
      groups.push({ kind, failed: 0, pairs: [] })
    }
    const entry = groups[index]!
    entry.pairs.push({ call, result: result ?? null })
    if (result?.isError) {
      entry.failed += 1
    }
  }
  return groups
}

/** How many failed calls `toolRunSentence` states, its "(N failed)" summed
 *  over every group. */
export function toolRunSentenceFailures(blocks: readonly NativeChatBlock[]): number {
  return buildSentence(blocks).failed
}

/** How far into a run's one-line sentence a "(N failed)" is taken to be seen.
 *  The Claude app's own row, "Ran 2 commands (1 failed), created a file",
 *  ends its count at 25; "Ran 12 commands (2 failed)" at 26. 28 characters
 *  of the row's 13 dp type is about 200 dp, which a phone row keeps beside a
 *  "+A −R" pill and the chevron. Anything later can sit behind the ellipsis:
 *  a SendMessage's preview or a command's description comes before its count
 *  (review of c714c9bc: counts at 230 and 69). */
export const SENTENCE_FAILURE_VISIBLE_CHARS = 28

/** Whether the run's sentence, given the run's own `failedCallCount`, says
 *  every failure where the row surely shows it: it states `failedCallCount`
 *  failures, and its last "(N failed)" ends within
 *  SENTENCE_FAILURE_VISIBLE_CHARS. When not, the run header draws its own
 *  "N failed" label, or a failed run would read as a clean one. The sentence
 *  counts the error results it can give a group. A folded Codex poll's error
 *  is no group's, and a call known to have failed only from its own `failed`
 *  state has no error result, so both are in `failedCallCount` and not in the
 *  sentence (review of c714c9bc). Such a sentence states no count at all, and
 *  the label carries the total: "(1 failed)" beside "2 failed" was two
 *  different counts for one run (review, 2026-09-30). */
export function toolRunSentenceShowsFailures(
  blocks: readonly NativeChatBlock[],
  failedCallCount: number
): boolean {
  // Given the count, a sentence states all of the run's failures or none.
  const { failed, lastFailureEnd } = buildSentence(blocks, failedCallCount)
  return failed > 0 && lastFailureEnd <= SENTENCE_FAILURE_VISIBLE_CHARS
}

/** The run's sentence. With the run's own `failedCallCount` (the count the
 *  header's label draws), a sentence that counts fewer failures than that
 *  states none, so the row never shows two different counts. Without it,
 *  every failure the sentence can count is stated, as one call's sheet title
 *  reads it. */
export function toolRunSentence(
  blocks: readonly NativeChatBlock[],
  failedCallCount?: number
): string {
  return buildSentence(blocks, failedCallCount).text
}

/** One stretch of the sentence. `recipient` marks a SendMessage's addressee,
 *  which the row draws in its own tone so a spaced name ("@team lead") shows
 *  where it ends and the preview begins (review of a91c04d1). */
export type ToolRunSentenceSpan = { text: string; recipient?: true }

/** The sentence as spans, in order; their texts join to `toolRunSentence`
 *  given the same `failedCallCount`. */
export function toolRunSentenceSpans(
  blocks: readonly NativeChatBlock[],
  failedCallCount?: number
): ToolRunSentenceSpan[] {
  return buildSentence(blocks, failedCallCount).spans
}

/** Categories counted in files changed, not in calls. */
const FILE_KINDS: ReadonlySet<Kind> = new Set(['edit', 'write', 'notebook'])

/** The groups the sentence names: every one, or with more than
 *  TOOL_SENTENCE_MAX_CATEGORIES those with failures first, then the rest, cut
 *  to that many and put back in run order. */
function shownGroups(groups: readonly Group[]): readonly Group[] {
  if (groups.length <= TOOL_SENTENCE_MAX_CATEGORIES) {
    return groups
  }
  const picked = new Set(
    [...groups.filter((entry) => entry.failed > 0), ...groups.filter((entry) => entry.failed === 0)].slice(
      0,
      TOOL_SENTENCE_MAX_CATEGORIES
    )
  )
  return groups.filter((entry) => picked.has(entry))
}

function buildSentence(
  blocks: readonly NativeChatBlock[],
  failedCallCount?: number
): {
  text: string
  spans: ToolRunSentenceSpan[]
  /** Failures the sentence states, summed over its groups. */
  failed: number
  /** Where the last "(N failed)" ends in `text`; 0 when there is none. */
  lastFailureEnd: number
} {
  const groups = runGroups(blocks)
  // A run holding one described agent reads by it, with no failure count:
  // the header's own label then states the run's failures.
  const agentWords = describedAgentRunWords(groups.flatMap((entry) => entry.pairs))
  if (agentWords) {
    return { text: agentWords, spans: [{ text: agentWords }], failed: 0, lastFailureEnd: 0 }
  }
  // A count short of the run's own would sit beside the header's label as a
  // second, different number, so the sentence then states none.
  const counted = shownGroups(groups).reduce((sum, entry) => sum + entry.failed, 0)
  const statesFailures = failedCallCount === undefined || counted >= failedCallCount
  const spans: ToolRunSentenceSpan[] = []
  let failedTotal = 0
  let lastFailureEnd = 0
  let offset = 0
  const push = (part: ToolRunSentenceSpan[], failed: number): void => {
    if (spans.length > 0) {
      spans.push({ text: ', ' })
      offset += 2
    }
    for (const span of part) {
      spans.push(span)
      offset += span.text.length
    }
    if (failed > 0) {
      failedTotal += failed
      lastFailureEnd = offset
    }
  }
  const sole = groups.length === 1 && groups[0]!.pairs.length === 1 ? groups[0]!.pairs[0]! : null
  for (const entry of shownGroups(groups)) {
    const stated = statesFailures ? entry.failed : 0
    const failed = stated > 0 ? ` (${stated} failed)` : ''
    // A run of one call reads by its own target, as the app's row does; a
    // call beside other work is only counted in its category.
    if (sole && toolCallKind(sole.call.name) === 'message') {
      const detail = sendMessageDetail(sole.call)
      if (detail) {
        const preview = detail.preview ? ` ${detail.preview}` : ''
        push(
          [{ text: 'messaged ' }, { text: detail.to, recipient: true }, { text: `${preview}${failed}` }],
          stated
        )
        continue
      }
      push([{ text: `messaged an agent${failed}` }], stated)
      continue
    }
    const words = sole ? soleCallWords(sole) : null
    if (words) {
      push([{ text: `${words}${failed}` }], stated)
      continue
    }
    const noun = TOOL_SUMMARY_WORDS[entry.kind]
    // Edits count the files they changed, as the chip beside the row does;
    // every other kind counts its calls.
    const count = FILE_KINDS.has(entry.kind) ? editedFileCount(entry.pairs) : entry.pairs.length
    const amount = count === 1 ? noun.one : noun.many.replace('#', String(count))
    push([{ text: `${amount}${failed}` }], stated)
  }
  if (spans.length === 0) {
    return { text: '', spans: [], failed: 0, lastFailureEnd: 0 }
  }
  const first = spans[0]!
  spans[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) }
  // Neighbouring plain stretches are one: a row with no recipient is one string.
  const merged: ToolRunSentenceSpan[] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && !last.recipient && !span.recipient) {
      merged[merged.length - 1] = { text: last.text + span.text }
    } else if (span.text !== '') {
      merged.push(span)
    }
  }
  return {
    text: merged.map((span) => span.text).join(''),
    spans: merged,
    failed: failedTotal,
    lastFailureEnd
  }
}
