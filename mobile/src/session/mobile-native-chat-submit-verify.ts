import type { RpcClient } from '../transport/rpc-client'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import {
  claudeSentBashTexts,
  claudeSentPromptTexts,
  claudeSubmitNotice,
  readClaudeInput
} from './claude-composer-screen'
import { shellCommandOfSend } from './mobile-native-chat-shell-command'
import {
  MOBILE_NATIVE_CHAT_SCREEN_READ_MS,
  readMobileNativeChatScreen,
  type MobileNativeChatScreen
} from './mobile-native-chat-screen-read'
import { appWasAwaySince } from './app-foreground-clock'

/**
 * What the desktop did with a message the host took.
 *  - `sent`: the agent's own prompt copy (the hook beacon's `up=`) carried the
 *    words, or a look after the Enter found the words gone from the input.
 *  - `not-sent`: Claude's own notice is on screen ("Removed N invisible
 *    characters · review and press Enter to send", or "· nothing left to
 *    send"). Only that proves it: the words still in the input could be a lost
 *    Enter or one Claude has not taken yet. `message` is what the user is told.
 *  - `unknown`: looks were had and none settled it (a dialog in the composer's
 *    place, the words still in the input after the whole window). The caller
 *    holds the send for the transcript or a beacon copy, as it does for an ack
 *    that never came; it never restores the draft or invites a resend.
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
 * The floor before the first look. Orca 1.4.218 writes the Enter before it acks,
 * so the Enter is not what this waits for. It is a floor and not evidence:
 * "the input is empty" is what a submitted message looks like, and also what a
 * body Claude has not read yet looks like (a lagging Claude reads body and Enter
 * together, late, as one read of 64 bytes or more, and the Enter is then text).
 * So an empty input is `sent` only after some look saw the words in it, or with
 * the prompt drawn in the conversation (or the queue box) above it, or the
 * beacon's copy. A fast normal send is drawn by that echo row; anything else
 * waits out the window and is held as `unknown`.
 */
export const SUBMIT_SETTLE_MS = 300
/** Between looks. */
export const SUBMIT_LOOK_GAP_MS = 600
/** How long the beacon is waited for, and the looks repeated, before giving up. */
export const SUBMIT_VERIFY_WINDOW_MS = 4_500
const TICK_MS = 150

const dense = (text: string): string => text.replace(/[\s`]+/g, '').toLowerCase()

/** The chip Claude Code 2.1.288 draws for a pasted image, in the input and in the
 *  sent prompt's row (`[Image #${n}]`, read from the binary). */
const IMAGE_CHIP = /\[Image #\d+\]/g
/** Whitespace is folded before a chip is matched: Claude's word wrap can break a chip at its
 *  inner space (`[Image` over `#4]`) and the input's rows are joined with a newline. */
const folded = (text: string): string => text.replace(/\s+/g, ' ')
const hasImageChip = (text: string): boolean => /\[Image #\d+\]/.test(folded(text))
const withoutImageChips = (text: string): string => folded(text).replace(IMAGE_CHIP, '')

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
  /** The send pasted photos ahead of its words: Claude draws each as an `[Image #N]`
   *  chip in the input and in the sent prompt's row. The chips are set aside when
   *  the words are compared, and a photo-only send is told by the chips alone. */
  images?: boolean
  /** The `! cmd` rows the screen held BEFORE a shell-command send wrote anything. The
   *  scrollback keeps every command ever run, so a repeat of one proves nothing: it counts
   *  as run only when the screen now holds more rows of it than it did then. `null`: no
   *  baseline could be had, so the echo row proves nothing (the bash box still does). */
  priorBashRows?: readonly string[] | null
  /** The send's own budget: no look runs past it. */
  deadline?: number
  wait?: (ms: number) => Promise<void>
  now?: () => number
}): Promise<SubmitVerdict> {
  const wait = args.wait ?? sleep
  const now = args.now ?? Date.now
  const startedAt = now()
  const wallStartedAt = Date.now()
  const window = Math.min(
    SUBMIT_VERIFY_WINDOW_MS,
    args.deadline === undefined ? Infinity : args.deadline - startedAt
  )
  // A confirmed `!` message is a shell command: while it is in the input the box shows the
  // command with the `!` taken off (bash mode), and once it is submitted Claude draws it as a
  // `! cmd` row, not a `❯` row, and fires no prompt hook (claudeSentBashTexts). Both the command
  // and the full text count as "the words", so a message that went as a plain prompt is seen too.
  const shell = shellCommandOfSend(args.text, 'claude')
  const words = dense(args.text).slice(0, WORDS_PREFIX_CHARS)
  const commandWords = shell === null ? '' : dense(shell).slice(0, WORDS_PREFIX_CHARS)
  const photos = args.images === true
  // `typed` is the input or a drawn prompt row. A photo send's words come after its chips,
  // so they are compared with the chips taken out; with no caption the chips are all there is.
  const heard = (typed: string): boolean => {
    const wanted = dense(photos ? withoutImageChips(typed) : typed)
    return (
      (words !== '' && wanted.startsWith(words)) ||
      (commandWords !== '' && wanted.startsWith(commandWords)) ||
      (photos && words === '' && hasImageChip(typed))
    )
  }
  let looked = false
  let failedLooks = 0
  let lastLookAt = -Infinity
  let sawWords = false
  /** What one picture of the screen settles, or null when it settles nothing. */
  const judge = (screen: MobileNativeChatScreen): SubmitVerdict | null => {
    looked = true
    const notice = claudeSubmitNotice(screen.lines)
    if (notice) {
      return { kind: 'not-sent', message: `Not sent. Claude says: ${notice}.` }
    }
    const input = readClaudeInput(screen.lines, screen.draft)
    if (!input.located) {
      return null
    }
    if (heard(input.text)) {
      sawWords = true
      return null
    }
    // The words are not in the input. That is a submitted message, or a body
    // Claude has not read yet (see SUBMIT_SETTLE_MS): told apart by having seen
    // the words in the input, or the prompt drawn above the composer. What is
    // left in the input may be a placeholder (a prompt suggestion, the queue
    // hint, "Message @agent…") or text from the desk, neither of which is this
    // message.
    return sawWords ||
      claudeSentPromptTexts(screen.lines).some((row) =>
        photos
          ? words !== '' && heard(row)
          : words !== '' && dense(row).startsWith(words)
      ) ||
      (shell !== null &&
        args.priorBashRows !== null &&
        claudeSentBashTexts(screen.lines).filter(heard).length >
          (args.priorBashRows ?? []).filter(heard).length)
      ? { kind: 'sent' }
      : null
  }
  const beaconHeard = (): boolean =>
    shell === null && args.receipts !== undefined && beaconHasWords(args.receipts(), args.seenNonces, args.text)
  while (now() - startedAt < window) {
    await wait(TICK_MS)
    if (beaconHeard()) {
      return { kind: 'sent' }
    }
    const elapsed = now() - startedAt
    if (elapsed < SUBMIT_SETTLE_MS || elapsed - lastLookAt < SUBMIT_LOOK_GAP_MS) {
      continue
    }
    lastLookAt = elapsed
    const screen = await readMobileNativeChatScreen({
      client: args.client,
      terminal: args.terminal,
      // `deadline` is on the caller's clock; the look runs on the wall clock.
      ...(args.deadline === undefined ? {} : { deadline: Date.now() + (args.deadline - now()) })
    })
    if (!screen) {
      // Two looks and not one picture of the screen: nothing here can be told,
      // and waiting out the window would only delay a send that went.
      failedLooks += 1
      if (!looked && failedLooks >= 2) {
        return { kind: 'unverified' }
      }
      continue
    }
    const verdict = judge(screen)
    if (verdict) {
      return verdict
    }
  }
  // The window ran out while the app was out of the foreground (2026-10-09): Android
  // ran no timer then, so the looks it was meant to hold never ran, and the send came
  // back to a window already over. One more look, on its own short budget since the
  // send's has gone the same way: Claude has had all that time to draw the prompt.
  if (appWasAwaySince(wallStartedAt)) {
    if (beaconHeard()) {
      return { kind: 'sent' }
    }
    const screen = await readMobileNativeChatScreen({
      client: args.client,
      terminal: args.terminal,
      deadline: Date.now() + MOBILE_NATIVE_CHAT_SCREEN_READ_MS
    })
    const verdict = screen ? judge(screen) : null
    if (verdict) {
      return verdict
    }
  }
  return { kind: looked ? 'unknown' : 'unverified' }
}
