import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
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
 * A row belongs to a hook submission of its words when it comes straight
 * after the row the submission names, as a prompt typed with the agent idle
 * does. That row lands no copy of the words from an earlier submission: one that
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

/** The hook submission each user row is, by row id: one of its words typed
 *  after the row just before it. Any other row is no one's. */
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
  // A row is a submission's only when it comes straight after the row the
  // submission names: a prompt typed with the agent idle is written at once,
  // with nothing between it and the text it was typed after. A message
  // queued mid-turn gets its row, if ever, when Claude dequeues it at the
  // turn's end, rows later; given such a row by the latest submission typed
  // before it, the row Claude wrote for the first of two queued messages of
  // the same words went to the second, still queued, and the first was
  // remembered as not landed by its own row, for good (review of 099b7eb0).
  raw.forEach((message, index) => {
    if (message.role !== 'user' || index === 0) {
      return
    }
    let owner: HookSubmission | undefined
    for (const submission of byKey.get(rowKeyOf(message)) ?? []) {
      if (submission.position === index - 1 && (owner === undefined || (submission.arrival ?? -Infinity) > (owner.arrival ?? -Infinity))) {
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

/**
 * The copies' words that a user row is made of, two or more of them joined:
 * Claude dequeues the messages still queued at a turn's end as one row, their
 * words a line apart. That row is each of theirs, and each copy was drawn
 * beside it until another row of its own words came along, which with the
 * prompt hook's copies was then the next submission's and never came
 * (the review of d147a9c4). By key, the index of the last such row, which a
 * copy typed after it cannot be.
 *
 * Only on the prompt hook's evidence, since a prompt typed at the desk can be
 * made of earlier messages' words too ("ok" and "continue", then "ok
 * continue"), and split, it retired a message taken mid-turn (the review of
 * c3844d00, J1): every part must be a hook-reported submission (a hook copy,
 * or a status copy the merge paired with one), and the row must be no
 * submission's of its own words (rowOwners: a prompt typed with the agent
 * idle comes straight after the row its hook copy names). A row made wholly
 * of the parts' words is needed too, so one that merely quotes a part lands
 * none. Without the hook's copies no row is split, as before.
 */
export function keysInJoinedRows(
  prompts: readonly Pick<DesktopPrompt, 'nonce' | 'text' | 'anchorId' | 'seenAt' | 'hookTwin'>[],
  raw: readonly NativeChatMessage[],
  keyOf: (text: string) => string,
  rowKeyOf: (message: NativeChatMessage) => string
): Map<string, number> {
  const words = [
    ...new Set(
      prompts
        .filter((prompt) => (prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) ? prompt.hookTwin !== undefined : true))
        .map((prompt) => keyOf(prompt.text))
        .filter((key) => key.length > 0)
    )
  ]
  const out = new Map<string, number>()
  if (words.length < 2) {
    return out
  }
  const owners = rowOwners(prompts, raw, keyOf, rowKeyOf)
  raw.forEach((message, index) => {
    if (message.role !== 'user' || owners.has(message.id)) {
      return
    }
    const parts = splitIntoWords(rowKeyOf(message), words)
    if (parts !== null && parts.length >= 2) {
      parts.forEach((part) => out.set(part, Math.max(out.get(part) ?? -1, index)))
    }
  })
  return out
}

/** `key` as the copies' words joined by single spaces, or null. Each place in
 *  the key is decided once: words that overlap made a row that almost splits
 *  cost twice as much for every repeat (the review of c3844d00, S1). */
function splitIntoWords(key: string, words: readonly string[]): string[] | null {
  const decided = new Map<number, string[] | null>()
  const from = (at: number): string[] | null => {
    if (at === key.length) {
      return []
    }
    const known = decided.get(at)
    if (known !== undefined) {
      return known
    }
    let found: string[] | null = null
    for (const word of words) {
      const end = at + word.length
      if (key.startsWith(word, at) && (end === key.length || key[end] === ' ')) {
        const rest = from(end === key.length ? end : end + 1)
        if (rest !== null) {
          found = [word, ...rest]
          break
        }
      }
    }
    decided.set(at, found)
    return found
  }
  return from(0)
}

/**
 * The prompts without a hook copy that reached the phone so long after its
 * status twin that the merge took it for a later submission
 * (HOOK_TWIN_LAG_MS), when the rows say it is the same one: it names a row at
 * or before the status copy's time, with no text written between. The
 * terminal's bytes can stall while the tab status flows, and such a copy was
 * drawn beside its own status copy (the review of d147a9c4, A3). A later
 * submission names a text row written after the status copy's time.
 */
export function withoutLateHookTwins(prompts: readonly DesktopPrompt[], raw: readonly NativeChatMessage[]): DesktopPrompt[] {
  const statusCopies = prompts.filter((prompt) => prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) && prompt.hookTwin === undefined && prompt.at !== undefined)
  if (statusCopies.length === 0) {
    return [...prompts]
  }
  const late = new Set<DesktopPrompt>()
  for (const copy of statusCopies) {
    const position = timedPosition(raw, copy.at)
    if (position === undefined) {
      continue
    }
    const twin = prompts.find((prompt) => {
      if (prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) || late.has(prompt) || prompt.anchorId === undefined) {
        return false
      }
      const anchor = raw.findIndex((message) => message.id === prompt.anchorId)
      return (
        (prompt.text === copy.text || normalizePromptField(prompt.text) === copy.text) &&
        typeof prompt.seenAt === 'number' &&
        typeof copy.seenAt === 'number' &&
        prompt.seenAt - copy.seenAt > HOOK_TWIN_LAG_MS &&
        anchor !== -1 &&
        anchor <= position &&
        !raw.slice(anchor + 1, position + 1).some(isTextRow)
      )
    })
    if (twin !== undefined) {
      late.add(twin)
    }
  }
  return prompts.filter((prompt) => !late.has(prompt))
}

/** A row the prompt hook could name: words or a picture, from either side. */
function isTextRow(message: NativeChatMessage): boolean {
  return message.role !== 'tool' && message.blocks.some((block) => block.type === 'text' || block.type === 'image-ref')
}
