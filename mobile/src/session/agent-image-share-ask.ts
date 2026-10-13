import type { MutableRefObject } from 'react'
import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../src/shared/tui-agent-display-names'
import { isTuiAgent } from '../../../src/shared/tui-agent-config'
import type { HostImageMissing } from './host-image-refusals'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  acquireMobileNativeChatTerminalWriteForSend,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

/**
 * Asking the agent to share a picture the desktop would not (lead decision,
 * 2026-10-13).
 *
 * Orca 1.4.224 shares a file outside every workspace once assistant TEXT in
 * the session names its absolute path with a clean boundary on both sides
 * (rule 1, `nativeChatTranscriptIncludesPath`); a Read's own input does not
 * count. So a picture the agent read or sent from a scratchpad stays a
 * placeholder unless the agent happens to write the path. The placeholder's
 * note offers one tap that sends a normal chat message asking for it, through
 * the composer's own send (outbox, echo, queue), and the phone's existing
 * retry fetches the picture once the reply names the path
 * (use-host-image-previews.ts).
 *
 * Never sent on its own: only a tap sends, once per picture until the reply
 * lands, and at most MAX_ASKS times for one picture in one tab.
 */

export const MAX_ASKS = 2

/** The agent's name as the button says it: "Claude", "Codex", or "the agent". */
export function agentShareName(agent: string | null | undefined): string {
  return agent && isTuiAgent(agent) ? TUI_AGENT_DISPLAY_NAMES[agent] : 'the agent'
}

export function fileNameOf(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}

/** The message a tap sends: one line, the file's name, and its absolute path
 *  in backticks so the agent can copy it exactly. */
export function shareAskText(path: string): string {
  const exact = path.replace(/[\r\n]+/g, ' ')
  return `Please write the full path of ${fileNameOf(exact)} in your reply, in backticks, so my phone can show it. It is \`${exact}\`.`
}

// Orca's boundary rule (terminal-output-path-candidates.ts, the same in the
// 1.4.224 bundle): a character from this set next to the path joins it, so
// `(path)` and a markdown link target `](path)` do not count.
const CONTINUES_PATH = /[A-Za-z0-9._~/%+@\\()[\]-]/

function containsWithBoundary(text: string, candidate: string): boolean {
  let start = text.indexOf(candidate)
  while (start !== -1) {
    const end = start + candidate.length
    const before = start === 0 || text.slice(0, start).endsWith('file://') || !CONTINUES_PATH.test(text[start - 1]!)
    const next = text[end]
    const after = next === undefined || (next === ':' && /^\d+(?::\d+)?(?:\D|$)/.test(text.slice(end + 1))) || !CONTINUES_PATH.test(next)
    if (before && after) {
      return true
    }
    start = text.indexOf(candidate, start + 1)
  }
  return false
}

/** True when `text` names `path` the way the desktop's rule 1 accepts it:
 *  in backticks, quotes or spaces, or before a sentence's final period. */
export function textNamesPathCleanly(text: string, path: string): boolean {
  return path.length > 0 && (containsWithBoundary(text, path) || containsWithBoundary(text, `${path}.`))
}

/** True when assistant TEXT the phone holds names the path at all. That is
 *  what the desktop's rule 1 reads; a Read call's own input does not count. */
export function agentTextNamesPath(messages: readonly NativeChatMessage[], path: string): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.blocks) &&
      message.blocks.some((block) => isTextBlock(block) && block.text.includes(path))
  )
}

/** True when assistant text the phone holds names `path` cleanly. */
export function agentTextNamesPathCleanly(messages: readonly NativeChatMessage[], path: string): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.blocks) &&
      message.blocks.some((block) => isTextBlock(block) && textNamesPathCleanly(block.text, path))
  )
}

function userText(message: NativeChatMessage): string | null {
  if (message.role !== 'user' || !Array.isArray(message.blocks)) {
    return null
  }
  return message.blocks.filter(isTextBlock).map((block) => block.text).join('\n').trim()
}

/** How many user rows already carry this exact ask. */
export function askRowsIn(messages: readonly NativeChatMessage[], text: string): number {
  return messages.filter((message) => userText(message) === text).length
}

/** One tab's asks for one picture. `rowsBefore` is how many rows with the
 *  same words the transcript held at the tap, so a second ask is told from
 *  the first by position. `afterId` is the transcript's last row at the tap:
 *  an ask sent while the agent works is usually taken as a `queued_command`
 *  attachment, which Orca's reader drops, so it may never get a row of its
 *  own, and the reply is then whatever the agent wrote after the tap. */
export type ShareAskRecord = { asks: number; rowsBefore: number; afterId: string | null; sending: boolean }

export type ShareAskPhase = 'offer' | 'asked' | 'none'

/**
 * What the placeholder offers:
 * - `none` unless the desktop's last answer was "not shared" (while it is
 *   still answering, or after a failed fetch, there is nothing to ask for);
 * - `offer` before any ask, and once more after a reply that landed without
 *   naming the path cleanly (the agent finished, the picture still refused);
 * - `asked` from the tap until that reply lands. A reply that names the path
 *   cleanly keeps it: the phone is asking the desktop again, and its answer
 *   either brings the picture or turns the note to "couldn't be fetched".
 */
export function shareAskPhase(args: {
  record: ShareAskRecord | undefined
  messages: readonly NativeChatMessage[]
  path: string
  working: boolean
  missing: HostImageMissing | undefined
}): ShareAskPhase {
  const { record, messages, path } = args
  if (args.missing !== 'not-shared') {
    return 'none'
  }
  if (!record) {
    return 'offer'
  }
  if (record.sending) {
    return 'asked'
  }
  const text = shareAskText(path)
  let seen = 0
  let row = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (userText(messages[index]!) === text) {
      seen += 1
      if (seen === record.rowsBefore + 1) {
        row = index
        break
      }
    }
  }
  // No row of its own: taken mid-turn (no record the phone receives), or still
  // on its way. The reply is then what came after the tap, once the agent is
  // idle; a tap whose row is gone from the loaded window keeps waiting.
  const from = row !== -1 ? row : record.afterId === null ? -1 : messages.findIndex((message) => message.id === record.afterId)
  if (row === -1 && record.afterId !== null && from === -1) {
    return 'asked'
  }
  const replies = messages
    .slice(from + 1)
    .filter((message) => message.role === 'assistant' && Array.isArray(message.blocks))
    .flatMap((message) => message.blocks.filter(isTextBlock).map((block) => block.text))
  if (replies.length === 0 || args.working || replies.some((reply) => textNamesPathCleanly(reply, path))) {
    return 'asked'
  }
  return record.asks < MAX_ASKS ? 'offer' : 'none'
}

const records = new Map<string, ShareAskRecord>()
const listeners = new Set<() => void>()

export function shareAskKey(tabKey: string, path: string): string {
  return `${tabKey}\0${path}`
}

export function shareAskRecord(tabKey: string | undefined, path: string | undefined): ShareAskRecord | undefined {
  return tabKey && path ? records.get(shareAskKey(tabKey, path)) : undefined
}

export function setShareAskRecord(key: string, record: ShareAskRecord | undefined): void {
  if (record) {
    records.set(key, record)
  } else {
    records.delete(key)
  }
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeShareAsks(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetShareAsksForTests(): void {
  records.clear()
}

export const SHARE_ASK_BUSY = 'Another input is still being sent. Try again.'

/** The words of asks on their way: the composer send treats a refusal of one
 *  as the user's own typed words, which it is not. */
const asksInFlight = new Set<string>()

/** The composer send's draft restore, minus an ask's words: they were never
 *  in the box, and appended to the user's draft they would ride its next send.
 *  The ask's button comes back instead. */
export function withoutAskDraftRestore<Origin>(restore: (origin: Origin, text: string) => void): (origin: Origin, text: string) => void {
  return (origin, text) => {
    if (!asksInFlight.has(text.trimEnd())) {
      restore(origin, text)
    }
  }
}

/** The composer send's failure report, minus the Retry while an ask is on its
 *  way: Retry sends the composer's words, which are not the ask. */
export function withoutAskRetry<Details extends { retry?: boolean }>(
  report: (message: string, details?: Details) => void
): (message: string, details?: Details) => void {
  return (message, details) => {
    if (details === undefined) {
      report(message)
    } else {
      report(message, asksInFlight.size > 0 && details.retry ? { ...details, retry: false } : details)
    }
  }
}

/** The composer's text send, holding the terminal's write lock as the
 *  composer's own send does (taken FOR a send, so the write lets go of it once
 *  the body is in): an ask typed into the middle of a photo paste or a queued
 *  send's Enter would be submitted as part of it. */
export function lockedShareAskSend(args: {
  handleRef: MutableRefObject<string | null>
  send: (text: string) => Promise<MobileNativeChatSendOutcome>
  onSendError: (message: string) => void
}): (text: string) => Promise<MobileNativeChatSendOutcome> {
  return async (text) => {
    const terminal = args.handleRef.current
    const owner = terminal ? acquireMobileNativeChatTerminalWriteForSend(terminal) : null
    if (terminal && !owner) {
      args.onSendError(SHARE_ASK_BUSY)
      return 'rejected'
    }
    const words = text.trimEnd()
    asksInFlight.add(words)
    try {
      return await args.send(text)
    } finally {
      asksInFlight.delete(words)
      if (terminal && owner) {
        releaseMobileNativeChatTerminalWrite(terminal, owner)
      }
    }
  }
}
