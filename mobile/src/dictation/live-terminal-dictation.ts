import { liveDictationDelta } from '../hooks/mobile-live-dictation-delta'
import type { LiveDictationTarget } from './place-dictation-transcript'

/** `sendLiveTerminalInput`: true only once the desktop wrote the bytes. False on a rejected RPC, a
 *  dropped connection, a stale tab or oversize input, and callers treat a rejection the same way. */
export type LiveTerminalSend = (handle: string, bytes: string) => Promise<boolean>

/**
 * A phone-recogniser dictation typed straight onto a terminal line (live input on). Each transcript
 * update goes over as a delta, backspaces for the words the recogniser revised and then the new
 * tail, worked out from `typed`: the text the terminal ACKNOWLEDGED, never the text last sent.
 */
export type PtyDictationTarget = {
  readonly kind: 'pty'
  readonly handle: string
  /** What this dictation has put on the line: advanced only by a send that answered true. */
  typed: string
  /** The newest transcript, which the sends bring `typed` to. */
  wanted: string
  /** Whether a send is in flight. The next delta is worked out when it answers. */
  sending: boolean
  /** Settles once every send started so far has answered. */
  drained: Promise<void>
}

/**
 * The target for a dictation that starts on `handle`. When the one it replaces was typing onto the
 * same line and still has a send in flight, this one's words go after that one's have landed:
 * two dictations sending at once would splice their words together on the line.
 */
export function ptyDictationTarget(handle: string, previous: LiveDictationTarget): PtyDictationTarget {
  const before =
    previous.kind === 'pty' && previous.handle === handle ? previous.drained : Promise.resolve()
  return { kind: 'pty', handle, typed: '', wanted: '', sending: false, drained: before }
}

/**
 * One transcript update onto the line. At most one send is in flight per target; updates that
 * arrive meanwhile only move `wanted`, and the next delta covers all of them.
 *
 * `typed` used to be set to the transcript before the send answered, and the answer was never read
 * (review, 2026-09-30). A dropped send still counted as typed, so the next update sent only its tail,
 * or backspaced over characters the user had typed before speaking. Now a false or rejected send
 * leaves `typed` where the terminal has it, and the next update sends the whole difference again.
 * A send that rejects AFTER the desktop wrote the bytes cannot be told from one that never arrived,
 * and those words go over twice; nothing the phone receives separates the two.
 */
export function typeLiveTranscript(
  target: PtyDictationTarget,
  text: string,
  send: LiveTerminalSend
): void {
  target.wanted = text
  if (!target.sending) {
    target.drained = sendUntilTyped(target, target.drained, send)
  }
}

/** Cancelling the dictation takes back what the terminal took from it, once its sends have answered. */
export function eraseLiveTranscript(target: PtyDictationTarget, send: LiveTerminalSend): void {
  typeLiveTranscript(target, '', send)
}

async function sendUntilTyped(
  target: PtyDictationTarget,
  before: Promise<void>,
  send: LiveTerminalSend
): Promise<void> {
  target.sending = true
  try {
    await before
    while (target.typed !== target.wanted) {
      const wanted = target.wanted
      if (await sendDelta(target, liveDictationDelta(target.typed, wanted), send)) {
        target.typed = wanted
      } else if (target.wanted === wanted) {
        // No newer words to carry a retry: wait for the next update rather than resend the same
        // bytes for as long as the desktop is down.
        return
      }
    }
  } finally {
    target.sending = false
  }
}

const utf8 = new TextEncoder()

/** True once the terminal took the bytes. Otherwise one line names the terminal, how many bytes it
 *  did not take and why, and never the words: they are the user's dictation. */
async function sendDelta(
  target: PtyDictationTarget,
  delta: string,
  send: LiveTerminalSend
): Promise<boolean> {
  let why: string
  try {
    if (await send(target.handle, delta)) {
      return true
    }
    why = 'the send came back false: not connected, a stale tab, a rejected RPC or too large'
  } catch (error) {
    why = `the send threw: ${error instanceof Error ? error.message : String(error)}`
  }
  console.warn(
    `[dictation] live terminal ${target.handle} did not take ${utf8.encode(delta).byteLength} bytes of ` +
      `dictation (${why}); the next update sends the whole difference again`
  )
  return false
}
