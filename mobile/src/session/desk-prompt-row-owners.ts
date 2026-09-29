import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { normalizeReconcileText, normalizedUserText } from './mobile-native-chat-draft-reconcile'

/**
 * Which submission of a desk prompt's words each user row is.
 *
 * Any user row of a desk copy's words used to land the copy. So the same words
 * sent mid-turn and then typed at the desk as the next turn's prompt were one
 * message: the second turn's row landed the first turn's bubble, and one of the
 * two was drawn nowhere (gap D of the final review of fix/midturn-prompt-at-end).
 * The tab status cannot tell that row from the one Claude writes when it
 * dequeues a message still queued at a turn's end, and a rule that tried by
 * when the phone saw the queue box let go of it drew those twice.
 *
 * The prompt hook can. It fires once per submission, and not when Claude
 * dequeues one: on Claude Code 2.1.284 a prompt typed while a turn ran fired
 * UserPromptSubmit at its enqueue and none when Claude ran it as its own turn
 * after the first ended (checked 2026-09-29 in a private tmux server with a
 * hook that logged each event). So each hook copy is a submission of its own,
 * placed by the text row it names (`at=`), and a status copy stands for one
 * when the merge paired it with its hook copy (`hookTwin`).
 *
 * A row belongs to the latest hook submission of its words typed before it.
 * That row lands no copy of the words from an earlier submission: one that
 * reached the phone more than HOOK_TWIN_LAG_MS before the owner did, typed
 * before the row the owner names. Every other copy lands on it as before, so
 * without the hook's copies (a Codex tab, a Windows host, a tab launched
 * without the hook, a submission made while the phone did not listen to the
 * terminal) nothing changes.
 */

/** How long after the phone read a status copy the hook's copy of the same
 *  submission can still reach it: the two travel separate streams (the tab
 *  status and the terminal's bytes), a moment apart as a rule. */
export const HOOK_TWIN_LAG_MS = 30_000

/** A submission the prompt hook reported: the copy's nonce, the index of the
 *  row it was typed after, and when the hook's copy reached the phone. */
export type HookSubmission = { nonce: string; position: number; arrival: number | undefined }

/** Where a copy was typed and when the phone first had it, as far as known. */
export type CopyPlace = { nonce: string | null; position: number | undefined; arrival: number | undefined }

function hookAnchorOf(prompt: Pick<DesktopPrompt, 'nonce' | 'anchorId' | 'seenAt' | 'hookTwin'>): { anchorId: string; arrival: number | undefined } | null {
  if (prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX)) {
    const twin = prompt.hookTwin
    return twin?.anchorId ? { anchorId: twin.anchorId, arrival: twin.seenAt } : null
  }
  return prompt.anchorId ? { anchorId: prompt.anchorId, arrival: prompt.seenAt } : null
}

/** The submission a copy is, when the hook reported it and the row it names
 *  is held. */
export function hookSubmissionOf(
  prompt: Pick<DesktopPrompt, 'nonce' | 'anchorId' | 'seenAt' | 'hookTwin'>,
  raw: readonly NativeChatMessage[]
): HookSubmission | null {
  const hook = hookAnchorOf(prompt)
  if (hook === null) {
    return null
  }
  const position = raw.findIndex((message) => message.id === hook.anchorId)
  return position === -1 ? null : { nonce: prompt.nonce, position, arrival: hook.arrival }
}

/** Where a copy was typed: after the row the hook names, or else after the
 *  last row written by its time; and when the phone first had it. */
export function placeOfCopy(prompt: DesktopPrompt, raw: readonly NativeChatMessage[]): CopyPlace {
  const hook = hookSubmissionOf(prompt, raw)
  if (hook !== null) {
    return hook
  }
  return { nonce: prompt.nonce, position: timedPosition(raw, prompt.at), arrival: prompt.seenAt }
}

function timedPosition(raw: readonly NativeChatMessage[], at: number | undefined): number | undefined {
  if (at === undefined) {
    return undefined
  }
  let found: number | undefined
  raw.forEach((message, index) => {
    if (message.timestamp !== null && message.timestamp <= at) {
      found = index
    }
  })
  return found
}

/** The hook submission each user row is, by row id: the latest of its words
 *  typed before it. A row no submission of its words came before is no one's. */
export function rowOwners(
  prompts: readonly Pick<DesktopPrompt, 'nonce' | 'text' | 'anchorId' | 'seenAt' | 'hookTwin'>[],
  raw: readonly NativeChatMessage[],
  /** The key a copy's words land by, and a row's by, at the caller. */
  keyOf: (text: string) => string,
  rowKeyOf: (message: NativeChatMessage) => string = (message) =>
    keyOf(message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''))
): ReadonlyMap<string, HookSubmission> {
  const byKey = new Map<string, HookSubmission[]>()
  for (const prompt of prompts) {
    const submission = hookSubmissionOf(prompt, raw)
    const key = keyOf(prompt.text)
    if (submission !== null && key !== '') {
      byKey.set(key, [...(byKey.get(key) ?? []), submission])
    }
  }
  const owners = new Map<string, HookSubmission>()
  if (byKey.size === 0) {
    return owners
  }
  raw.forEach((message, index) => {
    if (message.role !== 'user') {
      return
    }
    const submissions = byKey.get(rowKeyOf(message))
    let owner: HookSubmission | undefined
    for (const submission of submissions ?? []) {
      if (submission.position < index && (owner === undefined || submission.position > owner.position || (submission.position === owner.position && (submission.arrival ?? -Infinity) >= (owner.arrival ?? -Infinity)))) {
        owner = submission
      }
    }
    if (owner !== undefined) {
      owners.set(message.id, owner)
    }
  })
  return owners
}

/** Whether a row a submission owns is a later submission's and not this
 *  copy's: its hook copy reached the phone more than HOOK_TWIN_LAG_MS after
 *  the copy did, and the copy was typed before the row it names. Unknown
 *  either way, the row is the copy's as before. */
export function ownedByLaterSubmission(owner: HookSubmission | undefined, copy: CopyPlace): boolean {
  return (
    owner !== undefined &&
    owner.nonce !== copy.nonce &&
    owner.arrival !== undefined &&
    copy.arrival !== undefined &&
    owner.arrival - copy.arrival > HOOK_TWIN_LAG_MS &&
    copy.position !== undefined &&
    copy.position < owner.position
  )
}

/**
 * The user rows each witnessed message must not retire on, by its id: the
 * ones it kept from before, and each row of its words a later submission of
 * them owns (ownedByLaterSubmission), placed by where the message was drawn
 * and timed by when the phone stored it. Kept on the witness from then on,
 * so it holds once the hook's copies that told are gone.
 */
export function witnessRowsNotItsOwn(
  messages: readonly NativeChatMessage[],
  current: readonly MobileNativeChatPendingMessage[],
  receipts: readonly Pick<DesktopPrompt, 'nonce' | 'text' | 'anchorId' | 'seenAt' | 'hookTwin'>[]
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const owners = receipts.length > 0 ? rowOwners(receipts, messages, normalizeReconcileText, (message) => normalizedUserText(message) ?? '') : null
  for (const item of current) {
    if (!item.id.startsWith('desk-') && !item.id.startsWith('absorbed-')) {
      continue
    }
    const rows = new Set(item.notItsRows ?? [])
    if (owners !== null && owners.size > 0) {
      const key = normalizeReconcileText(item.text)
      const anchor = item.baselineTailMessageId ? messages.findIndex((message) => message.id === item.baselineTailMessageId) : -1
      const place = {
        nonce: item.id.startsWith('desk-') ? item.id.slice('desk-'.length) : null,
        position: anchor === -1 ? undefined : anchor,
        arrival: item.witnessedAt
      }
      for (const message of messages) {
        if (normalizedUserText(message) === key && ownedByLaterSubmission(owners.get(message.id), place)) {
          rows.add(message.id)
        }
      }
    }
    if (rows.size > 0) {
      out.set(item.id, [...rows])
    }
  }
  return out
}
