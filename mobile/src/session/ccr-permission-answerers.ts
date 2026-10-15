import type { CcrPendingPermission, CcrPermissionChoice } from './ccr-permission-request'

/**
 * The permission prompts a live Anthropic control lane holds (use-ccr-control-lane.ts), by host
 * and worktree, so a notification's Approve / Deny / Deny with comment can answer the prompt with
 * a `control_response` as the Claude app's notification does, instead of keys into the terminal
 * (parity audit 2026-10-15, gap 8). Only while the app runs with that chat mounted: a tap that
 * finds nothing here takes the terminal path as before.
 *
 * A banner is matched to a held prompt by what it asks, never by position. Its key is the one the
 * terminal path built (`mobileChatPermissionKey` over `parseApprovalFromStatus`: "Allow <tool>?",
 * no command, the host's summary). The held prompt must be for the same tool, the summary must be
 * one of its own input values exactly, and exactly one prompt in the worktree may match; anything
 * less sends nothing (CLAUDE.md, "Prefer refusing over guessing").
 */

export type CcrPermissionAnswerer = {
  /** The prompt the lane holds now, or null. */
  pending: () => CcrPendingPermission | null
  answer: (pending: CcrPendingPermission, choice: CcrPermissionChoice, comment?: string) => Promise<boolean>
}

const answerers = new Map<string, Map<string, CcrPermissionAnswerer>>()
const scope = (hostId: string, worktreeId: string): string => `${hostId}\0${worktreeId}`

/** Registers the tab's lane; the returned function takes it back out. */
export function registerCcrPermissionAnswerer(hostId: string, worktreeId: string, tabId: string, answerer: CcrPermissionAnswerer): () => void {
  const key = scope(hostId, worktreeId)
  const tabs = answerers.get(key) ?? new Map<string, CcrPermissionAnswerer>()
  tabs.set(tabId, answerer)
  answerers.set(key, tabs)
  return () => {
    if (tabs.get(tabId) === answerer) {
      tabs.delete(tabId)
    }
    if (tabs.size === 0 && answerers.get(key) === tabs) {
      answerers.delete(key)
    }
  }
}

export function resetCcrPermissionAnswerersForTests(): void {
  answerers.clear()
}

/** Whether a banner's key asks what `pending` asks. */
export function bannerAsks(permissionKey: string, pending: CcrPendingPermission): boolean {
  const [title = '', , summary = ''] = permissionKey.split('\u0000')
  if (title !== `Allow ${pending.toolName}?` || summary.trim() === '') {
    return false
  }
  return Object.values(pending.input).some((value) => typeof value === 'string' && value === summary)
}

/**
 * Answers a banner's tap through the lane holding its prompt. Null when no live lane in that
 * worktree holds exactly one prompt matching the banner (the terminal path then).
 */
export function answerCcrPermissionFromNotification(input: { hostId: string; worktreeId: string; permissionKey: string; choice: CcrPermissionChoice; comment?: string }): Promise<boolean> | null {
  const tabs = answerers.get(scope(input.hostId, input.worktreeId))
  const matches: { answerer: CcrPermissionAnswerer; pending: CcrPendingPermission }[] = []
  for (const answerer of tabs?.values() ?? []) {
    const pending = answerer.pending()
    if (pending && bannerAsks(input.permissionKey, pending)) {
      matches.push({ answerer, pending })
    }
  }
  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.warn(`[ccr-control] notification answer not sent through Anthropic — ${matches.length} prompts in the worktree match it`)
    }
    return null
  }
  const match = matches[0]!
  return match.answerer.answer(match.pending, input.choice, input.comment)
}
