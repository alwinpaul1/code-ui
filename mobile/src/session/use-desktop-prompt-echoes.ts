import { useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

type DesktopPrompt = { nonce: string; text: string }

/**
 * Prompts the user typed on the DESKTOP, drawn on the phone as their own
 * bubbles.
 *
 * Why they need this path at all: Claude Code writes a prompt submitted while
 * a turn is running as an `attachment`/`queued_command` record, and Orca's
 * transcript reader drops those, so the phone's transcript never carries them
 * (2026-09-13). The text arrives on the HUD beacon instead, from the agent's
 * own UserPromptSubmit hook.
 *
 * Each prompt is anchored to whatever the last transcript row was when it
 * first arrived, and stays there — the same treatment a phone-side echo gets
 * when its own transcript row never lands. The anchor is remembered per
 * prompt, so later turns cannot drag it down the conversation.
 */
export function useDesktopPromptEchoes(
  prompts: readonly DesktopPrompt[],
  folded: readonly NativeChatMessage[]
): MobileNativeChatPendingMessage[] {
  const anchors = useRef(new Map<string, string | null>())
  const echoes: MobileNativeChatPendingMessage[] = []
  for (const prompt of prompts) {
    if (!anchors.current.has(prompt.nonce)) {
      anchors.current.set(prompt.nonce, folded.at(-1)?.id ?? null)
    }
    echoes.push({
      id: `desk-${prompt.nonce}`,
      text: prompt.text,
      expectedOccurrence: 0,
      baselineTailMessageId: anchors.current.get(prompt.nonce) ?? null,
      baselineResolved: true
    })
  }
  return echoes
}

/** Drop prompts the transcript already shows: a prompt submitted while the
 *  agent was idle IS written as a user turn, and would otherwise appear
 *  twice. Compared on trimmed text against the tail of the conversation. */
export function withoutLandedDesktopPrompts(
  prompts: readonly DesktopPrompt[],
  folded: readonly NativeChatMessage[]
): DesktopPrompt[] {
  const seen = new Set(
    folded
      .filter((message) => message.role === 'user')
      .map((message) =>
        message.blocks
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
          .trim()
      )
      .filter((text) => text.length > 0)
  )
  return prompts.filter((prompt) => !seen.has(prompt.text.trim()))
}
