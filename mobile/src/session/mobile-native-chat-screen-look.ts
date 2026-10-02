import { hostAnswersScreens, noteScreenReplySource } from './host-screen-answers'
import { MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS } from './mobile-native-chat-send-readiness'
import { replySource, terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

/** How long one read of the screen may take. */
const SCREEN_READ_MS = 2_000
/** Between reads of a screen that is not there yet. */
const RETRY_PAUSE_MS = 500
/**
 * How long a host that says it has no screen is read again. Orca 1.4.218's provider
 * snapshot read serializes for up to 750 ms and, when it fails, backs off for 1 s before it
 * tries again (`providerVisibleRetryAtByPtyId`), and a terminal still drawing mid-turn can
 * read as zero rows, so a single retry 200 ms later fell inside that window and refused a
 * live terminal. Read from the bundle; not captured.
 */
const UNAVAILABLE_SPAN_MS = 1_500
/** The send's own budget when the caller names none (mobile-native-chat-send.ts). */
const FALLBACK_BUDGET_MS = 15_000
/** The wait for the link to come back looks again on this beat. */
const LINK_POLL_MS = 100

export type ScreenLook =
  /** A reply that names itself a screen, or names no source (an older host). */
  | {
      kind: 'read'
      reply: Awaited<ReturnType<typeof terminalScreenLinesRead.request>>
      lines: string[]
    }
  /** The host said it has no screen to show now. */
  | { kind: 'unavailable' }
  /** The host answered and refused, or answered with something that is no screen. */
  | { kind: 'rejected' }
  /** No answer: a timeout, or a link that is down or re-dialing. */
  | { kind: 'unreachable' }

type LookArgs = {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  deadline?: number
}

/** What the first read gets at least, though the budget less the reserve is short. */
const FIRST_READ_FLOOR_MS = 500

/** One read, no longer than `timeoutMs`. */
async function lookOnce(args: LookArgs, timeoutMs: number): Promise<ScreenLook> {
  try {
    const reply = await terminalScreenLinesRead.request(
      args.client,
      { terminal: args.terminal, screen: true },
      { timeoutMs: Math.max(1, timeoutMs), budgetSpansConnect: true }
    )
    const source = replySource(reply)
    noteScreenReplySource(args.client, source)
    if (source === 'screen-unavailable') {
      return { kind: 'unavailable' }
    }
    const lines = terminalScreenLinesRead.interpret(reply)
    return lines ? { kind: 'read', reply, lines } : { kind: 'rejected' }
  } catch {
    return { kind: 'unreachable' }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const linkIsUp = (client: object): boolean => {
  const state = (client as { getState?: () => string }).getState?.()
  return state === undefined || state === 'connected'
}

/**
 * One look at the tab's screen, read again where that can change the answer, the way the
 * write behind it waits for the link on the send's own budget.
 *  - unavailable: the host can show screens and has none now: read again for
 *    UNAVAILABLE_SPAN_MS.
 *  - rejected, on a host that has shown a screen: the same.
 *  - unreachable, on a host that has shown a screen: wait for the link when it is down or
 *    re-dialing, and read again, until the budget less what the writes behind it need
 *    (MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS) has run out. A slow relay is not a refusal.
 * No read is allowed to run into that reserve: each one is cut at the end of the budget, and
 * the budget is checked again after every pause.
 * Whether the host shows screens is taken ONCE, at the start, and kept across a reconnect in
 * the middle of the look (`hostAnswers` in the result): the note is stamped per connection, so
 * asking again after a re-dial read as "never shown a screen" and the send was typed unseen.
 * A failure on a host that has not shown a screen on this connection is not read again
 * (nothing could change it into a refusal): the caller fails open, as before.
 * `retry` false is a single look.
 */
export async function lookAtScreen(
  args: LookArgs,
  retry: boolean
): Promise<ScreenLook & { hostAnswers: boolean }> {
  const startedAt = Date.now()
  const deadline = args.deadline ?? startedAt + FALLBACK_BUDGET_MS
  const budgetEnd = deadline - MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS
  const answeredAtStart = hostAnswersScreens(args.client)
  const first = Math.min(deadline - startedAt, Math.max(budgetEnd - startedAt, FIRST_READ_FLOOR_MS))
  let seen = await lookOnce(args, Math.min(SCREEN_READ_MS, first))
  while (retry && seen.kind !== 'read') {
    const answers = seen.kind === 'unavailable' || answeredAtStart
    if (!answers || Date.now() >= budgetEnd) {
      break
    }
    if (seen.kind === 'unreachable') {
      // The link first, within the budget; then a short pause so a socket that is up
      // but slow is not read in a loop.
      while (!linkIsUp(args.client) && Date.now() < budgetEnd) {
        await sleep(LINK_POLL_MS)
      }
    } else if (Date.now() - startedAt >= UNAVAILABLE_SPAN_MS) {
      break
    }
    if (Date.now() >= budgetEnd) {
      break
    }
    await sleep(RETRY_PAUSE_MS)
    // The pause may have used the budget up: no read goes into the writes' reserve.
    if (Date.now() >= budgetEnd) {
      break
    }
    seen = await lookOnce(args, Math.min(SCREEN_READ_MS, budgetEnd - Date.now()))
  }
  return { ...seen, hostAnswers: answeredAtStart || seen.kind === 'unavailable' || hostAnswersScreens(args.client) }
}
