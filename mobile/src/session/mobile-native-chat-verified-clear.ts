import type { RpcClient } from '../transport/rpc-client'
import { readClaudeInput } from './claude-composer-screen'
import {
  buildMobileNativeChatClearInputOneRead,
  buildScreenSizedClearInput
} from './mobile-native-chat-input-clear'
import { clearMobileNativeChatInput } from './mobile-native-chat-send'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'

/** What the desktop input holds after the phone cleared it, said to the user
 *  when it will not go. The draft stays in the composer. */
export const INPUT_STILL_HOLDS_TEXT = 'The desktop input still holds text. Clear it there, then send again.'

/**
 * How the clear ended.
 *  - `cleared`: a look after the clear found the input empty.
 *  - `unverified`: no look could be had (the read failed, timed out, came from
 *    an older host, or found no composer: a dialog where it should be). The clear
 *    went out as one write and nothing says it worked, which is how every send
 *    went before there were looks. Failing OPEN here is deliberate: refusing
 *    every send to a host that cannot be read would be a worse bug than the one
 *    this fixes, and it is said in the report.
 *  - `still-holds`: two clears, and a look after each still found text. The
 *    caller must write nothing more.
 *  - `write-failed`: a clear write was refused or ran out of budget.
 */
export type VerifiedClearResult = 'cleared' | 'unverified' | 'still-holds' | 'write-failed'

/** Claude repaints within a frame of a key; this is the settle before the look,
 *  and it also keeps the clear and the body out of one stdin read. */
export const CLEAR_SETTLE_MS = 150
/** One clear, and one more after a look that still found text. */
const MAX_CLEAR_PASSES = 2

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Empty Claude Code's input before the body is typed, and prove it empty.
 *
 * Why not count bytes: Claude reads a control byte as a key only when the whole
 * stdin READ is under 64 bytes, and writes made back to back are one read, so
 * no chunk size is safe by counting (see MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS).
 * 2026-10-01: a 176-character message went out as the message, 33 newlines and
 * the message again, and Claude declined to submit it.
 *
 * So the clear is sized from the screen, not guessed: look, count the rows the
 * input takes between the composer's two rules, send ONE write under 64 bytes
 * for those rows, wait, look again. A bare `❯` and nothing under it is empty:
 * the body may go. Still text: one more clear and one more look, then stop.
 * The look also separates the clear from the body in time.
 *
 * BS (0x08) is exempt from the 64-byte rule in the same tokenizer, and was
 * considered and not used: `Go` maps it to a backspace with ctrl set on a macOS
 * host (a delete-word there), and any backspace only reaches text left of the
 * cursor, where Ctrl+U and Ctrl+K do not care where the cursor is.
 */
export async function clearClaudeInputVerified(args: {
  client: RpcClient
  terminal: string
  /** Every text the phone believes may be on the line (a parked launch draft, a
   *  recalled queue, the mirrored draft); sizes the clear only when the screen
   *  cannot be read, and decides whether an empty screen needs a clear at all. */
  believedTexts: readonly (string | null | undefined)[]
  mobileClient?: { id: string; type: 'mobile' }
  deadline?: number
  settle?: (ms: number) => Promise<void>
}): Promise<VerifiedClearResult> {
  const settle = args.settle ?? sleep
  const write = (clearInput: string) =>
    clearMobileNativeChatInput({
      client: args.client,
      terminal: args.terminal,
      clearInput,
      ...(args.mobileClient ? { mobileClient: args.mobileClient } : {}),
      ...(args.deadline === undefined ? {} : { deadline: args.deadline })
    })
  const look = async () => {
    const screen = await readMobileNativeChatScreen({
      client: args.client,
      terminal: args.terminal,
      ...(args.deadline === undefined ? {} : { deadline: args.deadline })
    })
    return screen ? readClaudeInput(screen.lines, screen.draft) : null
  }
  const believesSomething = args.believedTexts.some((text) => Boolean(text))

  let input = await look()
  if (!input?.located) {
    // Nothing to size from or check against: one write, as large as one read allows.
    const written = await write(buildMobileNativeChatClearInputOneRead(...args.believedTexts))
    return written ? 'unverified' : 'write-failed'
  }
  for (let pass = 0; pass < MAX_CLEAR_PASSES; pass++) {
    if (input.text === '' && !believesSomething) {
      return 'cleared'
    }
    // Empty on screen yet believed typed: the keys may be on their way to the
    // screen, so clear one row and look again rather than trust the empty read.
    if (!(await write(buildScreenSizedClearInput(input.rows)))) {
      return 'write-failed'
    }
    await settle(CLEAR_SETTLE_MS)
    input = await look()
    if (!input?.located) {
      return 'unverified'
    }
    if (input.text === '') {
      return 'cleared'
    }
  }
  return 'still-holds'
}
