import { useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

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
  folded: readonly NativeChatMessage[],
  scopeKey: string
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
  const live = new Set(queued.map((text) => text.trim()).filter((text) => text.length > 0))
  for (const text of previous.current) {
    const key = text.trim()
    if (key.length > 0 && !live.has(key) && !held.current.has(key)) {
      counter.current += 1
      held.current.set(key, {
        text,
        anchorId: folded.at(-1)?.id ?? null,
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
          .trim()
      )
  )
  for (const key of Array.from(held.current.keys())) {
    if (landed.has(key) || live.has(key)) {
      held.current.delete(key)
    }
  }
  return [...held.current.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      id: `queued-${entry.seq}`,
      text: entry.text,
      expectedOccurrence: 0,
      baselineTailMessageId: entry.anchorId,
      baselineResolved: true
    }))
}
