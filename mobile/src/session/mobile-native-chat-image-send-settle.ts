import { readClaudeInput } from './claude-composer-screen'
import { MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS } from './mobile-native-chat-image-send'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'
import type { RpcClient } from '../transport/rpc-client'

/**
 * What a photo send waits for between the image paste and the caption's Enter.
 *
 * Why it must wait for the chips and not for a fixed beat. Claude Code 2.1.288 (read
 * from the binary, never run) handles a pasted image PATH asynchronously: the paste
 * handler (`NVe`) sets its "pasting" flag, reads the file and resizes it, and only
 * then inserts the `[Image #N]` chip and clears the flag (`I()`). A Return key that
 * arrives while the flag is up is swallowed and remembered (`E.current=true`), and the
 * path that finishes an image read clears that memory WITHOUT submitting (`I()` sets
 * `E.current=false`; only the text-paste path (`G()`) replays it). So an Enter that
 * lands before the last chip is lost: the photos and the caption stay in the input and
 * nothing says why. A text paste replays a deferred Return, which is why a text send
 * never lost its Enter this way. The host writes the body, then the Enter about half a
 * second later; a 300 ms settle is shorter than reading three phone photos.
 *
 * So Claude's send looks at the screen until the input holds every chip. Only Claude's
 * screen is read: Codex has no chip to look for and keeps the fixed beat it always had.
 * A screen that cannot be read at all keeps the fixed beat too (the submit check after
 * the Enter then says what it can). Chips that never all appear within the wait refuse
 * the send before the caption is typed, the draft restored. That fails CLOSED in two
 * cases that are not a slow read: Claude draws no chip because it could not read the
 * image and typed the path as text, and a screen read that fails AFTER the composer was
 * seen (a missed look is waited through, and the wait then ends in the refusal). Both
 * restore the draft and press no Enter.
 */
export const IMAGE_CHIPS_POLL_MS = 250
/** The longest the chips are waited for. The wait is the TUI's pace, not transport
 *  latency, so it is credited back to the text body's budget like the settle. */
export const IMAGE_CHIPS_WAIT_MS = 6_000
export const IMAGE_CHIPS_MISSING =
  'The photos did not attach on the desktop, so nothing was sent. Your message is still here; send it again.'

/** Whitespace is folded first: at phone width Claude's word wrap can break a chip at its inner
 *  space (`[Image` over `#4]`), and the rows are joined with a newline. */
const chipsIn = (text: string): number => text.replace(/\s+/g, ' ').match(/\[Image #\d+\]/g)?.length ?? 0

export type ImageSendSettle = {
  /** Why the caption must not be sent, or null to go on. */
  readonly refusal: string | null
  /** The text body's deadline: the send's own, plus the time spent waiting here. */
  readonly textDeadline: number
}

export async function settleAfterImagePaste(args: {
  client: RpcClient
  terminal: string
  agent: string | null | undefined
  /** How many images were pasted. */
  expected: number
  deadline: number
  /** The settle's own beat; injected so tests need not wait for it. */
  sleep: (ms: number) => Promise<void>
}): Promise<ImageSendSettle> {
  const startedAt = Date.now()
  await args.sleep(MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS)
  const credited = (): ImageSendSettle => ({
    refusal: null,
    textDeadline: args.deadline + (Date.now() - startedAt)
  })
  if (args.agent !== 'claude') {
    return { refusal: null, textDeadline: args.deadline + MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS }
  }
  const giveUpAt = startedAt + IMAGE_CHIPS_WAIT_MS
  let located = false
  for (;;) {
    const screen = await readMobileNativeChatScreen({
      client: args.client,
      terminal: args.terminal,
      deadline: giveUpAt
    })
    if (screen) {
      const input = readClaudeInput(screen.lines, screen.draft)
      if (input.located) {
        located = true
        if (chipsIn(input.text) >= args.expected) {
          return credited()
        }
      }
    } else {
      // No picture of the screen (an older host, a failed read): nothing here can be told
      // and the fixed beat stands, as it did before this looked. Once the composer has been
      // seen, a failed look is only a missed one and the wait goes on.
      if (!located) {
        return credited()
      }
    }
    if (Date.now() + IMAGE_CHIPS_POLL_MS >= giveUpAt) {
      // No composer ever located: the screen is not one this can read, so the beat stands.
      return located ? { refusal: IMAGE_CHIPS_MISSING, textDeadline: args.deadline + (Date.now() - startedAt) } : credited()
    }
    await new Promise<void>((resolve) => setTimeout(resolve, IMAGE_CHIPS_POLL_MS))
  }
}
