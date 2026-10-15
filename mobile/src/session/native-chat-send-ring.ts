import type { ClaudeChatGate } from './use-claude-anthropic-transcript'

/**
 * Whether the chat's Send button draws the Claude app's progress ring while a send is in flight
 * (MobileNativeChatSendSlot `sending`): only on a Claude tab matched to its Anthropic session, as
 * the session's other Claude app features are. It showed on any Claude tab before (review
 * 2026-10-15); an unmatched Claude tab and every Codex tab keep the plain arrow.
 */
export function claudeSendRingShown(agent: string | null | undefined, gate: ClaudeChatGate | undefined): boolean {
  return agent === 'claude' && gate?.kind === 'matched'
}
