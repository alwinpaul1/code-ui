import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  agentTitle,
  foldWhitespace,
  readNotifications,
  readString,
  type Launch,
  type Notification
} from './mobile-background-task-transcript'

// ─── Which agent id is which ─────────────────────────────────────────────────
//
// The phone pairs a tool call with its result first-in-first-out, because
// Orca's reader drops the tool_use ids. For agents launched side by side that
// pairing is wrong: Claude Code writes each launch result when the launch is
// acknowledged, not in the order it made the calls. Five agents launched on
// 2026-09-23 (Claude Code 2.1.281, fixtures/claude-parallel-agents-2.1.281.ts)
// had their results written 4th, 2nd, 1st, 3rd, 5th, so three of the five
// rows carried another agent's title, time, and transcript.
//
// Claude Code does say which id is which, in two places the phone reads:
//   - the host's roster (`agentStatus.subagents`), which Orca fills from
//     Claude's own `background_tasks` inventory, id and description together;
//   - an agent's finished notification: `<task-id>` plus a summary that
//     quotes the description, `Agent "Keep phone's own message copy" finished`.
// Where either names an id, the launch takes the call with that description.
// Where neither does, the pairing stays as it was: there is nothing better.

/** `Agent "<description>" finished`, and the rarer endings seen across this
 *  machine's transcripts (`was stopped by Claude`, and a restarted session's
 *  `Background agent "…" didn't finish before…`). Greedy, so a description
 *  that itself contains a quote still reads to the last one. */
const AGENT_SUMMARY = /^(?:Background agent|Agent) "([\s\S]+)" (?:finished|failed|was stopped|didn't finish)/

/** The summary is escaped the way Claude escapes XML text (`&amp;&amp;` in a
 *  command's summary), so the quoted description is decoded before it is
 *  compared with the description the call carried. */
function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

/** Agent id to the description Claude Code itself gave it, whitespace folded.
 *  Empty when nothing in hand names one. */
export function confirmedAgentDescriptions(
  messages: readonly NativeChatMessage[],
  subagents: readonly AgentSubagentSnapshot[] | undefined
): Map<string, string> {
  const confirmed = new Map<string, string>()
  for (const snapshot of subagents ?? []) {
    const description = snapshot.description?.trim()
    if (description) {
      confirmed.set(snapshot.id, foldWhitespace(description))
    }
  }
  for (const message of messages) {
    for (const block of message.blocks) {
      if (!isTextBlock(block)) {
        continue
      }
      for (const notification of readNotifications(block.text, 0)) {
        const quoted = AGENT_SUMMARY.exec(decodeXmlText(notification.value.summary ?? ''))?.[1]
        if (quoted) {
          confirmed.set(notification.id, foldWhitespace(quoted))
        }
      }
    }
  }
  return confirmed
}

/** A foreground agent's result is its whole report, then its id and a usage
 *  block (verbatim, 2026-08-11: "agentId: a093e15feb44a7819 (use SendMessage
 *  …)\n<usage>subagent_tokens: 92022…"). The usage block is written only once
 *  the run is over, so an agent whose result carries one has finished. A
 *  background launch's result has none. */
const FINISHED_RUN_USAGE = /<usage>\s*subagent_tokens:/

type AgentCall = { description: string | null; title: string; startedAt: number | null }

/** Put each agent launch under its own call where Claude Code has said which
 *  is which, and settle the ones that already reported in the foreground.
 *  Mutates the reader's own maps, which it builds fresh on every walk. */
export function settleAgentLaunches(
  launches: Map<string, Launch>,
  notifications: Map<string, Notification>,
  messages: readonly NativeChatMessage[],
  subagents: readonly AgentSubagentSnapshot[] | undefined,
  position: number
): void {
  const calls: AgentCall[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (isToolCallBlock(block) && block.name === 'Agent') {
        const description = readString(block.input, 'description')
        calls.push({
          description: description ? foldWhitespace(description) : null,
          title: agentTitle(block.input),
          startedAt: message.timestamp
        })
      } else if (isToolResultBlock(block) && FINISHED_RUN_USAGE.test(block.output)) {
        for (const launch of launches.values()) {
          if (launch.kind === 'agent' && block.output.includes(`agentId: ${launch.id}`) && !notifications.has(launch.id)) {
            notifications.set(launch.id, { status: 'completed', summary: null, at: position })
          }
        }
      }
    }
  }
  const confirmed = confirmedAgentDescriptions(messages, subagents)
  if (confirmed.size === 0) {
    return
  }
  const taken = new Set<number>()
  for (const launch of launches.values()) {
    const description = launch.kind === 'agent' ? confirmed.get(launch.id) : undefined
    const index = description
      ? calls.findIndex((call, at) => !taken.has(at) && call.description === description)
      : -1
    const call = calls[index]
    if (call) {
      taken.add(index)
      launch.title = call.title
      launch.startedAt = call.startedAt
    }
  }
}
