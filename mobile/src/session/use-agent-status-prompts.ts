import { useEffect, useMemo, useRef } from 'react'
import type { DesktopPrompt } from './agent-hud-beacon'
import {
  EMPTY_AGENT_STATUS_PROMPTS,
  observeAgentStatusPrompt,
  statusCarriesPrompt,
  type AgentStatusPromptSource
} from './agent-status-prompts'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import type { StatusSubagentMessage } from './mobile-native-chat-agent-messages'

const NO_PROMPTS: DesktopPrompt[] = []
/** The reconnect latch holds no status the phone read before the drop. */
const NOTHING_PENDING = Symbol('nothing pending')
const NO_AGENT_MESSAGES: readonly StatusSubagentMessage[] = []

/** The desktop prompts of the session a tab shows, read off its
 *  `agentStatus.prompt` as it changes, merged with the beacon's. Keyed on
 *  the session so a reused terminal never carries the last session's
 *  prompts into the next. */
export function useAgentStatusPrompts(
  sessionKey: string | null,
  status: AgentStatusPromptSource | undefined,
  beacon: readonly DesktopPrompt[] | undefined,
  /** Whether the host is connected now. The first status read after a
   *  reconnect is a first read (observeAgentStatusPrompt). */
  connected = true,
  /** Whether `status` is off a tab list the host sent since the screen opened,
   *  not the one the last visit cached (mobile-session-tabs-cache.ts). The
   *  first status the host sends after a cached one is a first read too. */
  live = true
): { prompts: DesktopPrompt[]; agentMessages: readonly StatusSubagentMessage[] } {
  const stateRef = useRef(EMPTY_AGENT_STATUS_PROMPTS)
  // The status the phone held when the link came back, which it read before;
  // the next one it gets is the first read since.
  // Its own mark for "nothing pending": a tab status can itself be null, and a
  // reconnect that came back to one disarmed a latch keyed on null (combined
  // review of fix/prompt-leak, 2026-09-27).
  // `cached`: a status was read off the tab list the last visit cached. The
  // screen paints that list before the host answers, so the chat's first
  // status of a session was the last visit's, and a message taken while the
  // chat was closed came on the next one, read as if the chat had watched it
  // arrive: timed by that status's stamp, the last tool ping before the chat
  // opened, it sat at the tail under the reply to it (device, 2026-09-27,
  // session 790eafa8). The host's first status ends it whether or not it is a
  // new object: the tab list keeps the cached objects when the host's are
  // equal, and a latch waiting for a new one would take the next prompt the
  // chat does watch arrive as found.
  const readRef = useRef<{
    connected: boolean
    stale: AgentStatusPromptSource | undefined | typeof NOTHING_PENDING
    cached: boolean
  }>({
    connected,
    stale: NOTHING_PENDING,
    cached: false
  })
  if (connected && !readRef.current.connected) {
    readRef.current = { ...readRef.current, connected, stale: status }
  } else {
    readRef.current = { ...readRef.current, connected }
  }
  if (!live && status != null) {
    readRef.current = { ...readRef.current, cached: true }
  }
  // A null status is no reading: it neither is the first read nor ends the
  // wait for one (pre-merge review of 06911823). Nor is one that carries no
  // prompt, Orca's stand-in when it will not use its hook row: taken as the
  // first read, it left the status after it, which carried a message taken
  // while the link was down, read as watched and timed by its ping, under the
  // words written after the message (agent-status-prompts.ts, 2026-09-29).
  const firstRead =
    statusCarriesPrompt(status) &&
    ((readRef.current.stale !== NOTHING_PENDING && status !== readRef.current.stale) || (live && readRef.current.cached))
  if (firstRead) {
    readRef.current = { connected, stale: NOTHING_PENDING, cached: false }
  }
  // Reduced during render: the status is a prop of this render, and the
  // reducer is pure and idempotent for the same input, so a re-render with
  // the same status changes nothing.
  stateRef.current = observeAgentStatusPrompt(stateRef.current, sessionKey, status, { firstRead })
  const prompts = stateRef.current.prompts
  // A prompt held back leaves one line saying why; a bubble that never
  // appears is otherwise the same as one lost (2026-09-26).
  const withheld = stateRef.current.withheld
  useEffect(() => {
    if (withheld !== null) {
      console.warn(withheld)
    }
  }, [withheld])
  // And one drawn says which clock placed it: a bubble at the tail under the
  // reply to it left nothing in the log to tell a prompt the chat watched
  // arrive from one it found (2026-09-27).
  const placed = stateRef.current.placed ?? null
  useEffect(() => {
    if (placed !== null) {
      console.info(placed)
    }
  }, [placed])
  const merged = useMemo(() => mergeDesktopPrompts(prompts, beacon ?? NO_PROMPTS), [prompts, beacon])
  return { prompts: merged, agentMessages: stateRef.current.agentMessages ?? NO_AGENT_MESSAGES }
}
