import { useEffect, useMemo, useState } from 'react'
import type { CcrEvent } from './ccr-session-api'
import { useClaudeChatLive } from './claude-chat-live'

/**
 * The next-prompt suggestion of a matched Claude tab, as the Claude app 1.261013.20 offers it.
 *
 * Claude Code 2.1.300 emits `{type:"prompt_suggestion", suggestion, uuid, session_id}` "after each
 * turn when promptSuggestions is enabled" (its SDK schema; never captured live, so whether a
 * Remote Control session sends one at all is unproven). The app's reducer (t5v.java:1221) hands
 * the lead's suggestion (c9u, no `parent_tool_use_id`) to its holder (r1n, behind the remote flag
 * `mobile_next_prompt_suggestion_enabled`), which drops it when the user sends or interrupts
 * (`r1n.d()`). The composer (k730.e) draws it in the empty field in the hint ink, two spaces and
 * an accept pill after it, at most two lines; a tap puts it in the field. a11y: "Suggested next
 * prompt: %1$s. Double tap to fill."
 *
 * Read from the events here: the newest lead suggestion stands until a lead prompt or reply comes
 * after it (a send, Stop's marker, the next turn). One the user has typed over stays gone.
 */

export type CcrPromptSuggestion = { uuid: string; text: string }

/** Events that neither start nor answer a turn: a suggestion stays up across them. */
const PASSING = new Set(['system', 'result', 'rate_limit_event', 'stream_event', 'control_request', 'control_response', 'tool_use_summary'])

export function ccrPromptSuggestion(events: readonly CcrEvent[]): CcrPromptSuggestion | null {
  for (let at = events.length - 1; at >= 0; at--) {
    const event = events[at]!
    const payload = event.payload
    const type = typeof payload.type === 'string' ? payload.type : ''
    if (payload.parent_tool_use_id || PASSING.has(type)) {
      continue
    }
    if (type !== 'prompt_suggestion') {
      // A lead prompt, reply or anything newer than this reader: the suggestion it followed is spent.
      return null
    }
    const text = typeof payload.suggestion === 'string' ? payload.suggestion.trim() : ''
    return text ? { uuid: typeof payload.uuid === 'string' ? payload.uuid : (event.eventId ?? text), text } : null
  }
  return null
}

/** The suggestion the composer offers while its field is empty and no turn runs; null on any tab
 *  without Anthropic's stream (a Codex tab, a Claude tab read from the desktop). Only a turn the
 *  live state says has ended (`working === false`) offers one: a suggestion that lands late, after
 *  the next prompt went, is never offered over that running turn (review 2026-10-15), as the app
 *  drops its suggestion when the user sends (`r1n.d()`). */
export function useCcrPromptSuggestion(value: string): CcrPromptSuggestion | null {
  const live = useClaudeChatLive()
  const events = live?.stream?.events ?? null
  const idle = live?.working === false
  const suggestion = useMemo(() => (events && idle ? ccrPromptSuggestion(events) : null), [events, idle])
  const [typedOver, setTypedOver] = useState<string | null>(null)
  const typing = value.length > 0
  useEffect(() => {
    if (typing && suggestion) {
      setTypedOver(suggestion.uuid)
    }
  }, [typing, suggestion])
  return suggestion && !typing && typedOver !== suggestion.uuid ? suggestion : null
}
