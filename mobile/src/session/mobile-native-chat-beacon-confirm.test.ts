import { describe, expect, it } from 'vitest'
import { findBeaconConfirmedSends } from './mobile-native-chat-beacon-confirm'
import type { UnconfirmedSend } from './mobile-native-chat-draft-reconcile'

function send(normalizedText: string, draftKey = 'd'): UnconfirmedSend {
  return {
    draftKey,
    pendingKey: null,
    text: normalizedText,
    normalizedText,
    baselineTailMessageId: null,
    deadline: null
  }
}

function prompt(text: string, nonce: string, cut?: boolean) {
  return cut === undefined ? { nonce, text } : { nonce, text, cut }
}

/** Why this exists: an ack-lost send waits UNCONFIRMED_SEND_DEADLINE_MS (20s)
 *  for a transcript row before it can be called sent. The agent's own
 *  UserPromptSubmit hook beacons the submitted text (`up=`) within about a
 *  second. This confirms the send; it never RETIRES the bubble — a mid-turn
 *  send's only transcript record is the attachment Orca drops, so a bubble
 *  retired on the receipt would have no row to be replaced by and would vanish
 *  (the 2026-09-13 defect). */
describe('the agent’s own prompt receipt confirms a send the transcript has not shown yet', () => {
  it('confirms a send whose exact text the agent echoed', () => {
    const entry = send('fix the login')
    expect(findBeaconConfirmedSends([prompt('fix the login', '1')], [entry])).toEqual([entry])
  })

  it('confirms through whitespace differences, as the transcript path does', () => {
    const entry = send('fix the login')
    expect(findBeaconConfirmedSends([prompt('  fix   the\tlogin \n', '1')], [entry])).toEqual([entry])
  })

  it('confirms on a prefix when the hook truncated the body', () => {
    const entry = send('fix the login screen and the signup screen too')
    const cutPrompt = prompt('fix the login screen and', '1', true)
    expect(findBeaconConfirmedSends([cutPrompt], [entry])).toEqual([entry])
  })

  /** fable's explicit case: a truncated receipt must not claim a DIFFERENT
   *  pending send that merely happens to start the same way. */
  it('does not let a truncated receipt claim a different send sharing its prefix', () => {
    const mine = send('fix the login screen and the signup screen too')
    const other = send('fix the login screen but only the button')
    const cutPrompt = prompt('fix the login screen', '1', true)
    const confirmed = findBeaconConfirmedSends([cutPrompt], [mine, other])
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]).toBe(mine)
  })

  it('confirms exactly one send per receipt, in send order, for identical text', () => {
    const first = send('ping')
    const second = send('ping')
    const once = findBeaconConfirmedSends([prompt('ping', '1')], [first, second])
    expect(once).toEqual([first])
    const twice = findBeaconConfirmedSends([prompt('ping', '1'), prompt('ping', '2')], [first, second])
    expect(twice).toEqual([first, second])
  })

  it('does not confirm the same send twice from one repeated receipt', () => {
    const entry = send('ping')
    expect(findBeaconConfirmedSends([prompt('ping', '1'), prompt('ping', '1')], [entry])).toEqual([entry])
  })

  // Failure path: the beacon is absent (hand-started session, Windows, older
  // build). Absence must degrade to the 20s transcript path, never confirm.
  it('confirms nothing when no receipt ever arrives', () => {
    expect(findBeaconConfirmedSends([], [send('fix the login')])).toEqual([])
  })

  it('confirms nothing when the receipt is for someone else’s prompt', () => {
    expect(findBeaconConfirmedSends([prompt('unrelated', '1')], [send('fix the login')])).toEqual([])
  })

  // Degenerate sizes: no sends held, and a single empty-text send.
  it('returns nothing when no sends are held', () => {
    expect(findBeaconConfirmedSends([prompt('anything', '1')], [])).toEqual([])
  })

  it('does not let an empty receipt confirm a real send', () => {
    expect(findBeaconConfirmedSends([prompt('', '1')], [send('fix the login')])).toEqual([])
  })

  it('does not let an empty-text send be confirmed by any receipt', () => {
    expect(findBeaconConfirmedSends([prompt('fix the login', '1')], [send('')])).toEqual([])
  })
})
