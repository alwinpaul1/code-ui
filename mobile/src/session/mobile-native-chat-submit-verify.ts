import type { RpcClient } from '../transport/rpc-client'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { claudeSubmitNotice, readClaudeInput } from './claude-composer-screen'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'

/**
 * What the desktop did with a message the host took.
 *  - `sent`: the agent's own prompt copy (the hook beacon's `up=`) carried the
 *    words, or a look after the Enter found the input empty.
 *  - `not-sent`: Claude's review notice is on screen, or the words were still in
 *    the input on two looks. `message` is what the user is told.
 *  - `unknown`: looks were had and none settled it (a dialog in the composer's
 *    place, other text in the input). The caller holds the send for the
 *    transcript or a beacon copy, as it does for an ack that never came.
 *  - `unverified`: no look could be had at all. The send is called sent, as it
 *    was before there were looks (see VerifiedClearResult).
 */
export type SubmitVerdict =
  | { kind: 'sent' }
  | { kind: 'not-sent'; message: string }
  | { kind: 'unknown' }
  | { kind: 'unverified' }

/** Why a word-for-word match is not the test: the first stretch of the message
 *  is enough to say "this is the words", and a long one is not drawn whole. */
const WORDS_PREFIX_CHARS = 40

/**
 * The host spaces a send's body and its Enter about half a second apart, so a
 * look taken at the ack can see the body typed and not yet submitted. No look
 * before this settles anything. (A look that early found the words still
 * there, called the send failed, put the draft back, and then the Enter landed.)
 */
export const SUBMIT_SETTLE_MS = 700
/** Between the two looks that must both find the words before they count. */
export const SUBMIT_LOOK_GAP_MS = 600
/** How long the beacon is waited for, and the looks repeated, before giving up. */
export const SUBMIT_VERIFY_WINDOW_MS = 4_500
const TICK_MS = 150

const dense = (text: string): string => text.replace(/[\s`]+/g, '').toLowerCase()

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function beaconHasWords(
  receipts: readonly BeaconPromptReceipt[],
  seen: ReadonlySet<string>,
  text: string
): boolean {
  const wanted = normalizeNativeChatUserText(text)
  return (
    wanted !== '' &&
    receipts.some((receipt) => {
      if (seen.has(receipt.nonce)) {
        return false
      }
      const heard = normalizeNativeChatUserText(receipt.text)
      // The hook cuts a long prompt (`cut`): its copy is then a start of the words.
      return heard !== '' && (receipt.cut ? wanted.startsWith(heard) : heard === wanted)
    })
  )
}

/**
 * Check, after the host acked a body and its Enter, that Claude took it.
 *
 * The ack says the host wrote the bytes. It does not say Claude submitted them:
 * 2026-10-01 a message arrived with 66 control bytes in it, Claude stripped
 * them and, having removed something, showed "Removed N invisible characters ·
 * review and press Enter to send" and submitted nothing. The chat had drawn it
 * as sent. Claude Code 2.1.287 draws that notice (`txe`) and its text is not
 * pinned to Enter, so it is matched by shape (claude-composer-screen.ts).
 *
 * Claude asked the user to review, so a not-sent verdict never presses Enter
 * again. A transcript row of `message + newlines + message` would not retire the
 * chat's own copy by text either, one more reason "sent" has to come from here.
 */
export async function verifyClaudeSubmit(args: {
  client: RpcClient
  terminal: string
  /** The words the send carried (already trimmed). */
  text: string
  /** The beacon's prompt copies, newest state at each call. */
  receipts?: () => readonly BeaconPromptReceipt[]
  /** Copies already in the beacon before this send wrote anything: they are old
   *  prompts, and an identical older one proves nothing about this send. */
  seenNonces: ReadonlySet<string>
  wait?: (ms: number) => Promise<void>
  now?: () => number
}): Promise<SubmitVerdict> {
  const wait = args.wait ?? sleep
  const now = args.now ?? Date.now
  const startedAt = now()
  const words = dense(args.text).slice(0, WORDS_PREFIX_CHARS)
  let looked = false
  let failedLooks = 0
  let lastLookAt = -Infinity
  let held = 0
  while (now() - startedAt < SUBMIT_VERIFY_WINDOW_MS) {
    await wait(TICK_MS)
    if (args.receipts && beaconHasWords(args.receipts(), args.seenNonces, args.text)) {
      return { kind: 'sent' }
    }
    const elapsed = now() - startedAt
    if (elapsed < SUBMIT_SETTLE_MS || elapsed - lastLookAt < SUBMIT_LOOK_GAP_MS) {
      continue
    }
    lastLookAt = elapsed
    const screen = await readMobileNativeChatScreen({ client: args.client, terminal: args.terminal })
    if (!screen) {
      // Two looks and not one picture of the screen: nothing here can be told,
      // and waiting out the window would only delay a send that went.
      failedLooks += 1
      if (!looked && failedLooks >= 2) {
        return { kind: 'unverified' }
      }
      continue
    }
    looked = true
    const notice = claudeSubmitNotice(screen.lines)
    if (notice) {
      return { kind: 'not-sent', message: `Not sent. Claude says: ${notice}.` }
    }
    const input = readClaudeInput(screen.lines, screen.draft)
    if (!input.located) {
      held = 0
    } else if (input.text === '') {
      return { kind: 'sent' }
    } else if (words !== '' && dense(input.text).includes(words)) {
      held += 1
      if (held >= 2) {
        return {
          kind: 'not-sent',
          message: 'Not sent: the message is still in the desktop input. Clear it there, then send again.'
        }
      }
    } else {
      held = 0
    }
  }
  return { kind: looked ? 'unknown' : 'unverified' }
}
