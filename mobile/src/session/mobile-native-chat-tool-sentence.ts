import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock,
  type NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'

/**
 * One plain sentence for a run of tool calls, the way the Claude app puts it:
 * "Ran 3 commands, read a file", "Ran 12 commands (2 failed), read 6 files",
 * "Ran Fix count wording and append cell diff" for a run of one described command,
 * "Ran skill", "Messaged @agent <summary or message>", "created a file" for
 * a Write the result is certain is new. Requested on 2026-09-12 in place of
 * "20× Bash cd … +17 more", extended 2026-09-24 (docs/claude-app-parity.md items 2–3)
 * to the Claude app's own wording for a single described command, a Skill
 * call, a SendMessage, and a whole-file write. Tool names are grouped by what
 * they did to the reader, not by the agent's vocabulary, so Claude's `Bash`
 * and Codex's `shell` both read as commands.
 */
type Kind = 'command' | 'read' | 'edit' | 'search' | 'agent' | 'web' | 'skill' | 'message' | 'other'

const NOUN: Record<Kind, { verb: string; one: string; many: string }> = {
  command: { verb: 'ran', one: 'a command', many: 'commands' },
  read: { verb: 'read', one: 'a file', many: 'files' },
  edit: { verb: 'edited', one: 'a file', many: 'files' },
  search: { verb: 'searched', one: 'once', many: 'times' },
  agent: { verb: 'ran', one: 'an agent', many: 'agents' },
  web: { verb: 'fetched', one: 'a page', many: 'pages' },
  skill: { verb: 'ran', one: 'skill', many: 'skills' },
  message: { verb: 'messaged', one: 'an agent', many: 'agents' },
  other: { verb: 'used', one: 'a tool', many: 'tools' }
}

export function toolCallKind(name: string): Kind {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^.*[./]/, '')
  if (/^(bash|shell|exec|run_command|terminal|command|powershell)$/.test(key)) {
    return 'command'
  }
  if (/^(read|read_file|readfile|cat|view|notebookread)$/.test(key)) {
    return 'read'
  }
  if (/^(edit|write|multiedit|notebookedit|apply_patch|create_file|write_file|patch)$/.test(key)) {
    return 'edit'
  }
  if (/^(grep|glob|search|list|ls|find|rg|list_dir)$/.test(key)) {
    return 'search'
  }
  if (/^(agent|task|subagent|spawn_agent)$/.test(key)) {
    return 'agent'
  }
  if (/^(webfetch|websearch|fetch|browse|web_search|web_fetch)$/.test(key)) {
    return 'web'
  }
  if (/^skill$/.test(key)) {
    return 'skill'
  }
  if (/^(sendmessage|send_message)$/.test(key)) {
    return 'message'
  }
  return 'other'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readFileName(block: NativeChatBlock): string | null {
  if (!isToolCallBlock(block) || toolCallKind(block.name) !== 'read') {
    return null
  }
  const input = record(block.input)
  const path = input ? (input.file_path ?? input.path ?? input.filePath) : undefined
  if (typeof path !== 'string') {
    return null
  }
  const name = path.split(/[/\\]/).pop()?.trim()
  return name && name.length > 0 ? name : null
}

/** A run of one Bash-shaped call reads by its own `description` (real Claude
 *  Code `Bash` calls carry one alongside `command`), the way the Claude app's
 *  row says "Ran Count K*_F changes in section3 accountings" instead of "Ran a
 *  command". */
function commandDescription(block: NativeChatBlock): string | null {
  if (!isToolCallBlock(block) || toolCallKind(block.name) !== 'command') {
    return null
  }
  const input = record(block.input)
  const description = input?.description
  if (typeof description !== 'string') {
    return null
  }
  const trimmed = description.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The one label a single call's own data can give in place of the generic
 *  noun ("a command", "a file") — a read's file name, or a command's own
 *  description. Anything else keeps the generic noun. */
function soleCallLabel(block: NativeChatBlock): string | null {
  return readFileName(block) ?? commandDescription(block)
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
export function sendMessageRecipient(input: unknown): string | null {
  return firstText(record(input), ['to', 'recipient'])?.trim() ?? null
}

/** SendMessage's recipient plus a one-line preview: its `summary` when it has
 *  one (the Claude app's row, 2026-09-24, checked against real `SendMessage`
 *  tool_use records in local Claude Code transcripts), else the `message`
 *  itself, else `content`. The 2026-09-26 call, seen in the sheet's Inputs
 *  list and the Claude app's row, had no summary and a `content` already cut
 *  ("…read of the fra..."), so the full `message` comes first. */
function sendMessageDetail(block: NativeChatBlock): { to: string; preview: string | null } | null {
  if (!isToolCallBlock(block) || toolCallKind(block.name) !== 'message') {
    return null
  }
  const to = sendMessageRecipient(block.input)
  if (!to) {
    return null
  }
  const text = firstText(record(block.input), ['summary', 'message', 'content'])
  if (!text) {
    return { to, preview: null }
  }
  const line = text.replace(/\s+/g, ' ').trim()
  const preview =
    line.length > SEND_MESSAGE_PREVIEW_MAX ? `${line.slice(0, SEND_MESSAGE_PREVIEW_MAX)}…` : line
  return { to, preview }
}

/** True only when a single edit-shaped call's own result is certain the file
 *  is new — a `command: "create"` or a "File created successfully" result,
 *  the same evidence `editFilesFromToolPair` requires of the inline diff
 *  card. Never a guess from the tool name alone. */
function soleCallCreatedFile(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): boolean {
  const files = editFilesForToolCall(call, result)
  return files !== null && files.length === 1 && files[0]!.changeKind === 'added'
}

type Group = {
  kind: Kind
  total: number
  failed: number
  /** The lone call's own label (file name / command description), only while
   *  it is still the only call of this kind in the run. */
  label: string | null
  /** The lone call and its result, kept only long enough to ask whether it
   *  created a file or to read a SendMessage's recipient and text — cleared the
   *  moment a second call of the same kind arrives, since neither question
   *  has one answer for a group. */
  soleCall: NativeChatToolCallBlock | null
  soleResult: NativeChatToolResultBlock | null
}

function runGroups(blocks: readonly NativeChatBlock[]): Group[] {
  const groups: Group[] = []
  const indexByKind = new Map<Kind, number>()
  const pending: number[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      const kind = toolCallKind(block.name)
      let index = indexByKind.get(kind)
      if (index === undefined) {
        index = groups.length
        indexByKind.set(kind, index)
        groups.push({ kind, total: 0, failed: 0, label: null, soleCall: null, soleResult: null })
      }
      const entry = groups[index]!
      entry.total += 1
      if (entry.total === 1) {
        entry.label = soleCallLabel(block)
        entry.soleCall = block
      } else {
        entry.label = null
        entry.soleCall = null
        entry.soleResult = null
      }
      pending.push(index)
    } else if (isToolResultBlock(block)) {
      // FIFO by ordinal, the pairing rule the fold itself uses.
      const index = pending.shift()
      const entry = index === undefined ? undefined : groups[index]
      if (!entry) {
        continue
      }
      if (block.isError) {
        entry.failed += 1
      }
      if (entry.total === 1 && entry.soleCall) {
        entry.soleResult = block
      }
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

/** Whether the run's sentence says every failure where the row surely shows
 *  it: it states at least `failedCallCount` failures, and its last
 *  "(N failed)" ends within SENTENCE_FAILURE_VISIBLE_CHARS. When not, the run
 *  header draws its own "N failed" label, or a failed run would read as a
 *  clean one. The sentence counts error results; a call known to have failed
 *  only from its own `failed` state is in `failedCallCount` and not in the
 *  sentence, so a mixed run is not taken as said (review of c714c9bc). */
export function toolRunSentenceShowsFailures(
  blocks: readonly NativeChatBlock[],
  failedCallCount: number
): boolean {
  const { failed, lastFailureEnd } = buildSentence(blocks)
  return failed > 0 && failed >= failedCallCount && lastFailureEnd <= SENTENCE_FAILURE_VISIBLE_CHARS
}

export function toolRunSentence(blocks: readonly NativeChatBlock[]): string {
  return buildSentence(blocks).text
}

function buildSentence(blocks: readonly NativeChatBlock[]): {
  text: string
  /** Failures the sentence states, summed over its groups. */
  failed: number
  /** Where the last "(N failed)" ends in `text`; 0 when there is none. */
  lastFailureEnd: number
} {
  const groups = runGroups(blocks)
  const parts: string[] = []
  let failedTotal = 0
  let lastFailureEnd = 0
  let offset = 0
  const push = (part: string, failed: number): void => {
    offset += parts.length > 0 ? 2 : 0
    parts.push(part)
    offset += part.length
    if (failed > 0) {
      failedTotal += failed
      lastFailureEnd = offset
    }
  }
  for (const entry of groups) {
    const failed = entry.failed > 0 ? ` (${entry.failed} failed)` : ''
    if (entry.kind === 'message' && entry.total === 1 && entry.soleCall) {
      const detail = sendMessageDetail(entry.soleCall)
      if (detail) {
        const preview = detail.preview ? ` ${detail.preview}` : ''
        push(`messaged @${detail.to}${preview}${failed}`, entry.failed)
        continue
      }
    }
    if (
      entry.kind === 'edit' &&
      entry.total === 1 &&
      entry.soleCall &&
      soleCallCreatedFile(entry.soleCall, entry.soleResult)
    ) {
      push(`created a file${failed}`, entry.failed)
      continue
    }
    const noun = NOUN[entry.kind]
    // A command reads by its own description only when it is the whole run:
    // beside other work the Claude app says "ran a command" ("Created a file,
    // ran a command", 2026-09-26), described or not.
    const label = entry.kind === 'command' && groups.length > 1 ? null : entry.label
    const amount = entry.total === 1 ? (label ?? noun.one) : `${entry.total} ${noun.many}`
    push(`${noun.verb} ${amount}${failed}`, entry.failed)
  }
  if (parts.length === 0) {
    return { text: '', failed: 0, lastFailureEnd: 0 }
  }
  const sentence = parts.join(', ')
  return {
    text: sentence.charAt(0).toUpperCase() + sentence.slice(1),
    failed: failedTotal,
    lastFailureEnd
  }
}
