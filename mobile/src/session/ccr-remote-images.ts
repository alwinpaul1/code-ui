/** Pictures from Anthropic's copy of a Claude Code session, as the chat's
 *  preview map takes them (use-ccr-session-images.ts fills it,
 *  use-host-image-previews.ts places it). Kept apart so the preview hook does
 *  not pull the sign-in store in with it. */
export type CcrRemoteImages = {
  /** A Read's picture by its `toolu_…` call id. */
  byToolUseId: Record<string, string>
  /** A user message's pasted pictures by its transcript uuid, in order; '' keeps a slot that stays a chip. */
  byUserMessageId: Record<string, string[]>
}

export const NO_CCR_IMAGES: CcrRemoteImages = { byToolUseId: {}, byUserMessageId: {} }
