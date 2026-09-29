import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'

/**
 * Where a copy read first after Orca's stand-in goes (`foundAt`,
 * agent-status-prompts.ts): gap C of the final review of
 * fix/midturn-prompt-at-end. The status cannot say whether the message was
 * there before the chat looked or came since, and each clock is wrong for
 * the other: the status's ping drew a message found there at the tail, under
 * the rows written after it, and its run's start (67763919, withdrawn in
 * f4a46e18) drew a message typed after the chat opened above rows written
 * before it, or nowhere with that start off the page.
 *
 * The prompt hook's copy settles it:
 * - With it, the copy goes after the row the hook names, where the message was
 *   typed either way. With that row not held, a copy that reached the phone
 *   after the stand-in did was heard as it was typed, and goes by the
 *   status's ping as any watched copy does (the review of 5d17a9d0, B2).
 * - With the hook and no copy of it, the message came before the chat
 *   listened to the terminal (while the chat is open it does, and a message
 *   typed then is beaconed): found, it goes by its run's start, as a copy
 *   found on the chat's first status does, or, with that start off the page,
 *   by the ping, since a message drawn late beats one drawn nowhere.
 * - The hook's copy can reach the phone a moment after the status's, so for
 *   STAND_IN_TWIN_WAIT_MS the copy is drawn where it was first seen, not
 *   remembered there, and waits; and one that comes later still moves a copy
 *   placed as found (replaceFoundByLateTwin; B1 of the same review).
 * - Without the hook the two cannot be told, and the ping places it as before
 *   (undefined).
 */

/** How long a copy read after Orca's stand-in, on a tab with the prompt
 *  hook, waits for the hook's copy of it before it is taken for one found. */
const STAND_IN_TWIN_WAIT_MS = 5_000
export const STAND_IN_WAIT = Symbol('wait for the hook copy')

/** Copies placed as found, which a late hook copy may still move. */
const foundAfterStandIn = new Set<string>()
const FOUND_CAP = 256

/** The last row written at or before a time (lastRowBefore). */
type RowBefore = (at: number | undefined) => string | null | undefined

function heardAsTyped(prompt: DesktopPrompt): boolean {
  const twinAt = prompt.hookTwin?.seenAt
  return twinAt !== undefined && prompt.standInAt !== undefined && twinAt >= prompt.standInAt
}

function byItsHookCopy(prompt: DesktopPrompt, rawMessages: readonly NativeChatMessage[], rowBefore: RowBefore): string | 'found' | undefined {
  const hookRow = prompt.hookTwin?.anchorId
  if (hookRow !== undefined && rawMessages.some((message) => message.id === hookRow)) {
    return hookRow
  }
  if (prompt.hookTwin === undefined) {
    return undefined
  }
  if (heardAsTyped(prompt)) {
    const row = rowBefore(prompt.at)
    return typeof row === 'string' ? row : undefined
  }
  return 'found'
}

export function placeAfterStandIn(
  prompt: DesktopPrompt,
  rawMessages: readonly NativeChatMessage[],
  promptHook: boolean,
  rowBefore: RowBefore
): string | typeof STAND_IN_WAIT | undefined {
  const byCopy = byItsHookCopy(prompt, rawMessages, rowBefore)
  if (byCopy !== undefined && byCopy !== 'found') {
    return byCopy
  }
  if (!promptHook && byCopy === undefined) {
    return undefined
  }
  if (byCopy === undefined && typeof prompt.seenAt === 'number' && Date.now() - prompt.seenAt < STAND_IN_TWIN_WAIT_MS) {
    return STAND_IN_WAIT
  }
  const row = rowBefore(prompt.foundAt)
  if (typeof row !== 'string') {
    return undefined
  }
  if (byCopy === undefined) {
    if (foundAfterStandIn.size >= FOUND_CAP) {
      foundAfterStandIn.clear()
    }
    foundAfterStandIn.add(prompt.nonce)
  }
  return row
}

/** Where a copy placed as found goes once its hook copy has come after all,
 *  or undefined to leave it. */
export function replaceFoundByLateTwin(
  prompt: DesktopPrompt,
  rawMessages: readonly NativeChatMessage[],
  rowBefore: RowBefore
): string | undefined {
  if (!foundAfterStandIn.has(prompt.nonce) || prompt.hookTwin === undefined) {
    return undefined
  }
  foundAfterStandIn.delete(prompt.nonce)
  const byCopy = byItsHookCopy(prompt, rawMessages, rowBefore)
  return byCopy === 'found' ? undefined : byCopy
}
