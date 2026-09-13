import { useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import {
  normalizeNativeChatUserText,
  stripImagePromptMarker
} from '../../../src/shared/native-chat-image-transcript-markers'

/**
 * Messages the user queued on the DESKTOP, kept on screen after the agent
 * takes them.
 *
 * Why this path exists alongside the prompt hook: Claude Code stores a prompt
 * submitted mid-turn as an `attachment`/`queued_command` record, and Orca's
 * transcript reader drops those, so the message vanishes from the phone the
 * moment the agent absorbs it. The hook fixes that for tabs launched with it,
 * but Claude Code reads `--settings` once at startup — its hot reload watches
 * settings FILES, which Code UI never writes — so a session already running
 * can never gain a hook (anthropics/claude-code#22679, 2026-09-13).
 *
 * The agent draws its own queue on its screen, though, and the phone already
 * parses it. An entry that leaves that list has been absorbed, so it is held
 * here and drawn where it was, until the transcript shows it (a prompt sent
 * while the agent is idle does land as a real user turn) or the tab changes.
 */
export function useAbsorbedQueueEchoes(
  queued: readonly string[],
  // Prompts the agent has already printed into its scrollback. A queued entry
  // is held when it LEAVES the queue; one of these is held as soon as it is
  // seen, because by then the agent has taken it — that is the only witness
  // for a prompt absorbed between two tool calls, which never renders as
  // queued at all (2026-09-13).
  sentPrompts: readonly string[],
  folded: readonly NativeChatMessage[],
  scopeKey: string,
  // Anchored on the RAW record, not the folded row: a folded run is one row
  // for the whole turn, so every echo would land on the same boundary and
  // stack (2026-09-13). The raw tail moves with each tool result, which is
  // what puts a "Ran N commands" fold between one prompt and the next.
  rawMessages: readonly NativeChatMessage[] = folded,
  // Prompts already drawn by another path — the phone's own pending echoes
  // and the hook's desktop prompts. The scrollback shows those too, and read
  // blind it drew each of them a second time (2026-09-13).
  ownPrompts: readonly string[] = []
): MobileNativeChatPendingMessage[] {
  const held = useRef(new Map<string, { text: string; anchorId: string | null; seq: number }>())
  const previous = useRef<readonly string[]>([])
  const scope = useRef(scopeKey)
  const counter = useRef(0)
  if (scope.current !== scopeKey) {
    scope.current = scopeKey
    held.current = new Map()
    previous.current = []
  }
  // Keyed on collapsed whitespace: the queue box and the scrollback wrap the
  // same message differently, and keying on the raw text showed it twice
  // (2026-09-13).
  const live = new Set(queued.map(promptKey).filter((text) => text.length > 0))
  const own = new Set(ownPrompts.map(promptKey))
  for (const text of sentPrompts) {
    const key = promptKey(text)
    if (key.length > 0 && !live.has(key) && !own.has(key) && !held.current.has(key)) {
      counter.current += 1
      held.current.set(key, { text, anchorId: rawMessages.at(-1)?.id ?? null, seq: counter.current })
    }
  }
  for (const text of previous.current) {
    const key = promptKey(text)
    if (key.length > 0 && !live.has(key) && !held.current.has(key)) {
      counter.current += 1
      held.current.set(key, {
        text,
        anchorId: rawMessages.at(-1)?.id ?? null,
        seq: counter.current
      })
    }
  }
  previous.current = queued
  // A queued message that did land as its own user turn needs no echo.
  const landed = new Set(
    folded
      .filter((message) => message.role === 'user')
      .map((message) =>
        message.blocks
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
      )
      .map(promptKey)
  )
  for (const key of Array.from(held.current.keys())) {
    if (landed.has(key) || live.has(key) || own.has(key)) {
      held.current.delete(key)
    }
  }
  return [...held.current.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      id: `queued-${entry.seq}`,
      // No bytes on the phone for a desktop-pasted image: drop its marker.
      text: stripImagePromptMarker(entry.text),
      expectedOccurrence: 0,
      baselineTailMessageId: entry.anchorId,
      baselineResolved: true
    }))
}

/** One key for the same message however it reached here: the queue box, the
 *  scrollback and the transcript each wrap it differently, and only the
 *  transcript keeps the `[Image #1]` markers, so both are normalised away. */
function promptKey(text: string): string {
  return normalizeNativeChatUserText(text)
}
