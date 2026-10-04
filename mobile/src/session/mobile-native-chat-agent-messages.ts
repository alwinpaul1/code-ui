import { useMemo } from 'react'
import { isToolCallBlock, isToolResultBlock, isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { AgentHudBeacon, DesktopPrompt } from './agent-hud-beacon'
import type { AgentMessagePrompt } from './agent-hud-beacon-agent-messages'
import { readLaunch, readString, takeAnsweredCall, type PendingCall } from './mobile-background-task-transcript'
import { PEER_TRAILING_FRAMES } from './claude-peer-message-frames'

/**
 * A message a subagent sent its lead, drawn the way the desktop TUI draws it:
 * a folded row, "Message from general-purpose", that opens to the message.
 *
 * Claude Code 2.1.283 delivers one as an `attachment`/`queued_command` whose
 * prompt is `<agent-message from="<agent id>">…`, or as an `isMeta` user row
 * behind "Another Claude session sent a message:". Orca 1.4.212's transcript
 * reader drops both (fixtures/claude-agent-message-read-image-2.1.283.ts), so
 * the phone draws it from what it does get:
 *   - the phone's own prompt hook, which Claude fires for these too: the
 *     message, cut at 2,000 bytes of its JSON-escaped text, and the row it came after;
 *   - on a tab launched without that hook, the TUI's own row
 *     (`› Message from @general-purpose (ctrl+o to expand)`), which names
 *     the sender and nothing more (screen-peer-notices.ts).
 *
 * Not the user's bubble, and not the peer bubble another SESSION's message
 * gets: that one carries a `<cross-session-message>` block and is left to
 * mobile-native-chat-peer-messages.ts.
 */

/** The row's one text block carries this hint, the sender after a colon (a
 *  text block has no other field for it), and the message as its text. */
export const AGENT_MESSAGE_PRESENTATION = 'agent-message'

export type SubagentMessage = { from: string; body: string }

/** A prompt the hook took at the row a subagent message names. */
export type SameRowPrompt = { nonce: string; text: string }

/** A subagent message the prompt hook carried, not yet placed. */
export type BeaconAgentMessage = {
  id: string
  from: string
  body: string
  /** The hook shortened the prompt, so the message ends early. */
  cut: boolean
  /** The transcript row that was last when the message was taken. */
  anchorId?: string
  /** Read back from the warm-start store, not heard this run. */
  restored?: true
  /** The row the chat drew it after before it was stored. */
  drawnAfter?: string
  /** When the phone received it: one found long after has no place until the
   *  row it came after loads (mobile-native-chat-agent-message-rows.ts). */
  seenAt?: number
  /** The terminal whose beacon carried it, where that row is stored: a
   *  nonce is the hook's process id, and another terminal can hold the same
   *  one (review of 2026-09-27). */
  terminal?: string
  /** The prompts the hook took after this message at the same row: each is
   *  drawn below the message, in the order they came, rather than straight
   *  after the row above it (mobile-native-chat-agent-message-rows.ts). */
  laterAtSameRow?: SameRowPrompt[]
  /** And those it took before the message at that row, which stay above it. */
  earlierAtSameRow?: SameRowPrompt[]
}

const OPENER = /^\s*Another Claude session sent a message(?: while you were working)?:[ \t]*\n/
/** The wrapper's first line: the tag, and nothing after it on that line. */
const OPEN_LINE = /^\s*<agent-message\b([^>\n]*)>[ \t]*(?:\n|$)/
const FROM = /\bfrom="([^"]+)"/
const CLOSE_TAG = '</agent-message>'
/** The harness's own line ahead of a report (2.1.283 wording, one line). */
const HANDBACK_PREAMBLE = /^\[Subagent hand-back\][^\n]*(?:\n|$)/
/** The harness indents every line of a hand-back report by two spaces. */
const HANDBACK_INDENT = '  '

/**
 * The sender id and message of a subagent's delivery, or null for anything
 * else: a person's prompt, another session's message, a bare opener.
 *
 * Only Claude Code's own wrapper counts, as the whole prompt: its first line
 * is `<agent-message from="…">` and nothing else, and `</agent-message>` ends
 * it, or one of the harness's own framing paragraphs follows that tag (a
 * delivery while the lead is idle, 2026-09-27 review: drawn as the user's
 * bubble again). A prompt that merely starts with the tag, or quotes the first line and
 * goes on in someone's words, is a person's prompt (review of 2026-09-26: the
 * shared harness classifier matched by the leading tag, and a desk prompt that
 * quoted one was drawn nowhere). `cut`: the hook shortened the prompt, so the
 * closing tag is missing and what came is the start.
 */
export function parseSubagentMessage(text: string, options: { cut?: boolean } = {}): SubagentMessage | null {
  const rest = text.replace(OPENER, '')
  const open = OPEN_LINE.exec(rest)
  const from = open ? FROM.exec(open[1] ?? '')?.[1]?.trim() : undefined
  if (!open || !from) {
    return null
  }
  let body = rest.slice(open[0].length)
  // The wrapper's own closing tag is the last one. A report may quote the tag,
  // and cutting at the first one dropped everything after the quote. After it
  // comes nothing, or one of the paragraphs Claude Code frames a delivery with
  // (a short message delivered while the lead is idle ends with one); the
  // same test its own display function makes (claude-peer-message-frames.ts).
  const whole = body.trimEnd()
  const close = whole.lastIndexOf(CLOSE_TAG)
  const after = close === -1 ? null : whole.slice(close + CLOSE_TAG.length)
  if (after !== null && (after === '' || PEER_TRAILING_FRAMES.includes(after))) {
    body = whole.slice(0, close)
  } else if (options.cut !== true) {
    return null
  }
  if (HANDBACK_PREAMBLE.test(body)) {
    body = dedent(body.replace(HANDBACK_PREAMBLE, ''))
  }
  return { from, body: body.replace(/\s+$/, '').replace(/^\n+/, '') }
}

/** Whether a stored text is a hand-back the hook cut: the wrapper's line,
 *  then the harness's own hand-back line. Without that second line a cut
 *  text cannot be told from a person's prompt that quotes the wrapper's
 *  first line. */
export function isCutHandback(text: string): boolean {
  const rest = text.replace(OPENER, '')
  const open = OPEN_LINE.exec(rest)
  return open !== null && HANDBACK_PREAMBLE.test(rest.slice(open[0].length)) && parseSubagentMessage(text, { cut: true }) !== null
}

/** The prompt hook sends a prompt's JSON string body cut at this many bytes
 *  (CLAUDE_HUD_PROMPT_HOOK_SCRIPT in agent-hud-launch-args.ts). */
const HOOK_CUT_BYTES = 2000
/** Short of the cut by a character the byte cut split, or the lone trailing
 *  backslash of an escape it split, which the beacon drops. */
const HOOK_CUT_SLACK_BYTES = 8
/** The most a dropped `\r` per line end may add back: 32 line ends. */
const CRLF_ALLOWANCE_BYTES = 64

/**
 * Whether a stored text is a subagent message the hook cut: the wrapper's
 * line, no closing tag, and as long as the hook's cut once written back as
 * the JSON body it was sent as. The build that stored these kept no cut flag.
 *
 * Written back, it comes out short when its lines ended in CRLF: the beacon's
 * unescape drops the `\r` of each `\r\n` (unescapeJsonStringBody), two bytes a
 * line (re-review of 2026-09-27), and nothing left in the text says whether
 * it had them. So it is also a cut when it reaches the cut with its line ends
 * counted as CRLF ones, up to CRLF_ALLOWANCE_BYTES of them, and not past the
 * cut: a text that was cut cannot be longer. Uncapped, a person's prompt of
 * many short lines 300 bytes under the cut was swept (combined review of
 * fix/prompt-leak, 2026-09-27). A CRLF request cut after more line ends than
 * the allowance covers is not swept. A `\b` or `\f` escape sizes exactly: the
 * unescape reads it as the character JSON means, and JSON.stringify writes
 * that back as the same two bytes. Only a copy stored by an older build, which
 * turned these escapes into the letters b and f, comes out a byte short for
 * each.
 *
 * So a text is taken as cut when, written back, it is within
 * HOOK_CUT_SLACK_BYTES + CRLF_ALLOWANCE_BYTES (72) bytes under the cut, the
 * CRLF part only as far as it has line ends. That a person's prompt quoting
 * the wrapper's first line stays short of this is an assumption: one in that
 * window is swept too, an accepted ambiguity.
 */
export function isCutAtHookLength(text: string): boolean {
  if (parseSubagentMessage(text, { cut: true }) === null || parseSubagentMessage(text) !== null) {
    return false
  }
  const sent = new TextEncoder().encode(JSON.stringify(text).slice(1, -1)).length
  const asCrlf = sent + Math.min(2 * (text.match(/\n/g)?.length ?? 0), CRLF_ALLOWANCE_BYTES)
  const reaches = (bytes: number) => bytes >= HOOK_CUT_BYTES - HOOK_CUT_SLACK_BYTES
  return reaches(sent) || (reaches(asCrlf) && asCrlf <= HOOK_CUT_BYTES + HOOK_CUT_SLACK_BYTES)
}

/** Whether a hook prompt is a subagent's message rather than something a
 *  person typed: the one test the desktop prompts and the rows agree on, so a
 *  prompt is drawn as exactly one of the two. */
export function isSubagentMessagePrompt(prompt: Pick<DesktopPrompt, 'text' | 'cut'>): boolean {
  return parseSubagentMessage(prompt.text, { cut: prompt.cut === true }) !== null
}

function dedent(report: string): string {
  const lines = report.split('\n')
  if (!lines.every((line) => line.trim().length === 0 || line.startsWith(HANDBACK_INDENT))) {
    return report
  }
  return lines.map((line) => line.slice(Math.min(HANDBACK_INDENT.length, line.length - line.trimStart().length))).join('\n')
}

/** The subagent messages among the prompt hook's beacons, which are in the
 *  order they came. */
export function beaconAgentMessages(prompts: readonly AgentMessagePrompt[] | undefined): BeaconAgentMessage[] {
  const found: BeaconAgentMessage[] = []
  const list = prompts ?? []
  list.forEach((prompt, index) => {
    const parsed = parseSubagentMessage(prompt.text, { cut: prompt.cut === true })
    if (!parsed) {
      return
    }
    const atSameRow = (other: AgentMessagePrompt) =>
      prompt.anchorId !== undefined && other.anchorId === prompt.anchorId && !isSubagentMessagePrompt(other)
    const sameRow = (others: readonly AgentMessagePrompt[]) => others.filter(atSameRow).map(({ nonce, text }) => ({ nonce, text }))
    const later = sameRow(list.slice(index + 1))
    const earlier = sameRow(list.slice(0, index))
    found.push({
      id: `agent-message:${prompt.nonce}`,
      from: parsed.from,
      body: parsed.body,
      cut: prompt.cut === true,
      ...(prompt.anchorId ? { anchorId: prompt.anchorId } : {}),
      ...(prompt.restored ? { restored: true as const } : {}),
      ...(prompt.drawnAfter ? { drawnAfter: prompt.drawnAfter } : {}),
      ...(typeof prompt.seenAt === 'number' ? { seenAt: prompt.seenAt } : {}),
      ...(later.length > 0 ? { laterAtSameRow: later } : {}),
      ...(later.length > 0 && earlier.length > 0 ? { earlierAtSameRow: earlier } : {})
    })
  })
  return found
}

/** The same, for the beacon of the session this tab shows: its own list of
 *  them, which outlives the last 40 prompts, in the order they came with the
 *  prompts that list still holds. Those it no longer holds came before all
 *  of them. */
export function agentMessagesOfBeacon(
  beacon: Pick<AgentHudBeacon, 'desktopPrompts' | 'agentMessagePrompts'> | null | undefined,
  /** The terminal the beacon is of: where each message's placement is stored. */
  terminal?: string | null
): BeaconAgentMessage[] {
  const kept = beacon?.agentMessagePrompts
  const prompts = beacon?.desktopPrompts ?? []
  const keptByNonce = new Map((kept ?? []).map((prompt) => [prompt.nonce, prompt]))
  const held = new Set(prompts.map((prompt) => prompt.nonce))
  const messages = kept
    ? beaconAgentMessages([
        ...kept.filter((prompt) => !held.has(prompt.nonce)),
        // The kept copy, which knows whether it was restored; one the kept
        // list shed is not drawn.
        ...prompts.flatMap((prompt) => keptByNonce.get(prompt.nonce) ?? (isSubagentMessagePrompt(prompt) ? [] : [prompt]))
      ])
    : beaconAgentMessages(prompts)
  return terminal ? messages.map((message) => ({ ...message, terminal })) : messages
}

export function useBeaconAgentMessages(
  beacon: Pick<AgentHudBeacon, 'desktopPrompts' | 'agentMessagePrompts'> | null | undefined,
  terminal?: string | null
): BeaconAgentMessage[] {
  const kept = beacon?.agentMessagePrompts
  const prompts = beacon?.desktopPrompts
  return useMemo(
    () => agentMessagesOfBeacon({ desktopPrompts: prompts ?? [], agentMessagePrompts: kept }, terminal),
    [kept, prompts, terminal]
  )
}

/**
 * Agent id to the name the TUI gives it: the Agent call's `name`, else its
 * `subagent_type` ("@probe", "@general-purpose"). The id is only in the
 * launch result, paired with its call the way the background-task reader
 * pairs them, since Orca's reader drops the tool_use ids.
 */
export function subagentNames(messages: readonly NativeChatMessage[]): Map<string, string> {
  const names = new Map<string, string>()
  const pending: PendingCall[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name === 'Task' ? 'Agent' : block.name, input: block.input, startedAt: null, callId: block.callId })
      } else if (isToolResultBlock(block)) {
        const call = takeAnsweredCall(pending, block)
        const id = call?.name === 'Agent' ? readLaunch(call, block.output)?.id : undefined
        const name = call ? (readString(call.input, 'name') ?? readString(call.input, 'subagent_type')) : null
        if (id && name) {
          names.set(id, name)
        }
      }
    }
  }
  return names
}

/** The hint of a row whose message the phone has only the start of. */
const CUT_AGENT_MESSAGE_PRESENTATION = 'agent-message-cut'

export function agentMessageRow(args: {
  id: string
  sender: string
  body: string
  /** Only the start of the message reached the phone. */
  cut?: boolean
  timestamp: number | null
}): NativeChatMessage {
  const hint = args.cut === true && args.body.length > 0 ? CUT_AGENT_MESSAGE_PRESENTATION : AGENT_MESSAGE_PRESENTATION
  return {
    id: args.id,
    role: 'system',
    timestamp: args.timestamp,
    source: 'transcript',
    blocks: [{ type: 'text', text: args.body, presentation: `${hint}:${args.sender}` }]
  }
}

/** The sender and message of a row this module drew, or null for any other;
 *  `cut` when the phone has only the start of the message. */
export function agentMessageOf(message: NativeChatMessage): { sender: string; body: string; cut?: true } | null {
  const block = message.blocks[0]
  if (message.role !== 'system' || message.blocks.length !== 1 || !block || !isTextBlock(block)) {
    return null
  }
  const presentation = block.presentation ?? ''
  const cutPrefix = `${CUT_AGENT_MESSAGE_PRESENTATION}:`
  if (presentation.startsWith(cutPrefix)) {
    return { sender: presentation.slice(cutPrefix.length), body: block.text, cut: true }
  }
  const prefix = `${AGENT_MESSAGE_PRESENTATION}:`
  return presentation.startsWith(prefix) ? { sender: presentation.slice(prefix.length), body: block.text } : null
}

/** The status's copies as words for the screen's sender-only rows, each
 *  under the agent's id and the name its launch gave it (the row shows one or
 *  the other: "@a9d5c2f85e94ca47f" for a hand-back, "@general-purpose"). */
export function screenRowBodies(
  messages: readonly StatusSubagentMessage[],
  raw: readonly NativeChatMessage[]
): { senders: string[]; body: string; cut: boolean; seenAt?: number }[] {
  if (messages.length === 0) {
    return []
  }
  const names = subagentNames(raw)
  return messages.map((message) => {
    const name = names.get(message.from)
    const senders = name ? [message.from, name] : [message.from]
    return { senders, body: message.body, cut: message.cut, ...(message.seenAt !== undefined ? { seenAt: message.seenAt } : {}) }
  })
}

/** What the tab status carried of a subagent message: who sent it, and as
 *  much of its words as fit (parseStatusSubagentPreview). */
export type StatusSubagentPreview = { from: string; body: string; cut: boolean }
/** The same, with when the phone first read it (its clock); none for a copy
 *  read on a first read of the status, which is never paired. */
export type StatusSubagentMessage = StatusSubagentPreview & { seenAt?: number }

const STATUS_OPENER = /^\s*Another Claude session sent a message(?: while you were working)?:\s+/
const STATUS_TAG = /^<agent-message\b([^>]*)>\s*/
const HANDBACK_LINE = '[Subagent hand-back]'
const REPORT_FOLLOWS = 'The report follows:'

/**
 * A subagent message as the tab status carries it, or null for anything else.
 *
 * Orca's hook puts every prompt on the tab status folded to one line and cut
 * at 200 characters (normalizePromptField in
 * src/shared/agent-status-field-normalization.ts), subagent messages
 * included. So it holds the first words of a short message, and none of a
 * hand-back's report: the harness's line before it is longer than that. A
 * text of fewer characters than the cap with no closing tag was not cut, and
 * is not the wrapper (a person's prompt that opens with the tag).
 */
export function parseStatusSubagentPreview(text: string, cut: boolean): StatusSubagentPreview | null {
  const rest = text.replace(STATUS_OPENER, '')
  const open = STATUS_TAG.exec(rest)
  const from = open ? FROM.exec(open[1] ?? '')?.[1]?.trim() : undefined
  if (!open || !from) {
    return null
  }
  let body = rest.slice(open[0].length)
  const close = body.lastIndexOf(CLOSE_TAG)
  if (close !== -1) {
    body = body.slice(0, close)
  } else if (!cut) {
    return null
  }
  if (body.startsWith(HANDBACK_LINE)) {
    const report = body.indexOf(REPORT_FOLLOWS)
    body = report === -1 ? '' : body.slice(report + REPORT_FOLLOWS.length)
  }
  return { from, body: body.trim(), cut: close === -1 }
}
