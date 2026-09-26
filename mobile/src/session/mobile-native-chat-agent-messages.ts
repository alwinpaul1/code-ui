import { useMemo } from 'react'
import { isToolCallBlock, isToolResultBlock, isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { readLaunch, readString, takeAnsweredCall, type PendingCall } from './mobile-background-task-transcript'

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
 *     message, cut at 2,000 characters, and the row it came after;
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

/** A subagent message the prompt hook carried, not yet placed. */
export type BeaconAgentMessage = {
  id: string
  from: string
  body: string
  /** The hook shortened the prompt, so the message ends early. */
  cut: boolean
  /** The transcript row that was last when the message was taken. */
  anchorId?: string
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
 * it. A prompt that merely starts with the tag, or quotes the first line and
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
  // The wrapper's own closing tag is the one that ends the prompt. A report
  // may quote the tag, and cutting at the first one dropped everything after
  // the quote.
  const whole = body.trimEnd()
  if (whole.endsWith(CLOSE_TAG)) {
    body = whole.slice(0, whole.length - CLOSE_TAG.length)
  } else if (options.cut !== true) {
    return null
  }
  if (HANDBACK_PREAMBLE.test(body)) {
    body = dedent(body.replace(HANDBACK_PREAMBLE, ''))
  }
  return { from, body: body.replace(/\s+$/, '').replace(/^\n+/, '') }
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

/** The subagent messages among the prompt hook's beacons, in order. */
export function beaconAgentMessages(prompts: readonly DesktopPrompt[] | undefined): BeaconAgentMessage[] {
  const found: BeaconAgentMessage[] = []
  for (const prompt of prompts ?? []) {
    const parsed = parseSubagentMessage(prompt.text, { cut: prompt.cut === true })
    if (parsed) {
      found.push({
        id: `agent-message:${prompt.nonce}`,
        from: parsed.from,
        body: parsed.body,
        cut: prompt.cut === true,
        ...(prompt.anchorId ? { anchorId: prompt.anchorId } : {})
      })
    }
  }
  return found
}

/** The same, for the beacon of the session this tab shows. */
export function useBeaconAgentMessages(prompts: readonly DesktopPrompt[] | undefined): BeaconAgentMessage[] {
  return useMemo(() => beaconAgentMessages(prompts), [prompts])
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
        pending.push({ name: block.name === 'Task' ? 'Agent' : block.name, input: block.input, startedAt: null })
      } else if (isToolResultBlock(block)) {
        const call = takeAnsweredCall(pending, block.output)
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

export function agentMessageRow(args: {
  id: string
  sender: string
  body: string
  timestamp: number | null
}): NativeChatMessage {
  return {
    id: args.id,
    role: 'system',
    timestamp: args.timestamp,
    source: 'transcript',
    blocks: [{ type: 'text', text: args.body, presentation: `${AGENT_MESSAGE_PRESENTATION}:${args.sender}` }]
  }
}

/** The sender and message of a row this module drew, or null for any other. */
export function agentMessageOf(message: NativeChatMessage): { sender: string; body: string } | null {
  const block = message.blocks[0]
  const prefix = `${AGENT_MESSAGE_PRESENTATION}:`
  if (message.role !== 'system' || message.blocks.length !== 1 || !block || !isTextBlock(block)) {
    return null
  }
  return block.presentation?.startsWith(prefix)
    ? { sender: block.presentation.slice(prefix.length), body: block.text }
    : null
}
