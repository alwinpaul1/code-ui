import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import {
  SUBMIT_LOOK_GAP_MS,
  SUBMIT_SETTLE_MS,
  SUBMIT_VERIFY_WINDOW_MS,
  verifyClaudeSubmit
} from './mobile-native-chat-submit-verify'
import {
  AFTER_REVIEW_NOTICE,
  composerWithTextInDraft,
  composerWithTextInRows,
  EMPTY_COMPOSER,
  INCIDENT_MESSAGE,
  REVIEW_NOTICE
} from './fixtures/claude-composer-2.1.287'

// Claude Code 2.1.287. The host spaces a send's body and its Enter about half a
// second apart, so no look settles anything before SUBMIT_SETTLE_MS, and the
// words still in the input count as "not sent" only on two looks.

type Look = { lines: string[]; draft?: string } | 'fail'

/** A client whose looks answer from a script (the last one repeats), on a clock
 *  the test moves with `wait`. */
function scene(looks: readonly Look[]) {
  let now = 0
  let index = 0
  const readAt: number[] = []
  const sendRequest = vi.fn(async () => {
    readAt.push(now)
    const look = looks[Math.min(index, looks.length - 1)]!
    index += 1
    if (look === 'fail') {
      throw new Error('Request timed out')
    }
    return {
      id: 'r',
      ok: true,
      result: { terminal: { source: 'screen', tail: look.lines, draft: look.draft ?? '' } }
    }
  })
  return {
    client: { sendRequest } as unknown as RpcClient,
    wait: async (ms: number) => {
      now += ms
    },
    clock: () => now,
    readAt,
    sendRequest,
    advance: (ms: number) => {
      now += ms
    }
  }
}

const verify = (
  s: ReturnType<typeof scene>,
  text: string,
  extra: Partial<Parameters<typeof verifyClaudeSubmit>[0]> = {}
) =>
  verifyClaudeSubmit({
    client: s.client,
    terminal: 'term',
    text,
    seenNonces: new Set(),
    wait: s.wait,
    now: s.clock,
    ...extra
  })

const holding = (text: string): Look => ({ lines: composerWithTextInRows(text) })
const empty: Look = { lines: EMPTY_COMPOSER }
const receipt = (
  nonce: string,
  text: string,
  extra: Partial<BeaconPromptReceipt> = {}
): BeaconPromptReceipt => ({
  nonce,
  text,
  ...extra
})

describe('checking that Claude took a message the host acked', () => {
  it("says not sent, with Claude's own words, when the review notice is up", async () => {
    const s = scene([{ lines: AFTER_REVIEW_NOTICE }])

    await expect(verify(s, INCIDENT_MESSAGE)).resolves.toEqual({
      kind: 'not-sent',
      message: `Not sent. Claude says: ${REVIEW_NOTICE}.`
    })
  })

  it('says sent once a look after the settle finds the input empty', async () => {
    const s = scene([empty])

    await expect(verify(s, 'hello')).resolves.toEqual({ kind: 'sent' })

    expect(s.readAt[0]).toBeGreaterThanOrEqual(SUBMIT_SETTLE_MS)
  })

  it('takes no look before the Enter has had time to land', async () => {
    const s = scene([empty])
    await verify(s, 'hello')
    expect(s.readAt.every((at) => at >= SUBMIT_SETTLE_MS)).toBe(true)
  })

  it('does not call the send failed when a look finds the words before the Enter landed', async () => {
    // The host types the body, waits, then presses Enter. One look in between
    // sees the words in the input and no notice: that is not "not sent". The
    // next look finds the input empty. (Called failed here, the draft went back
    // to the composer, the Enter landed, and the user sent it twice.)
    const s = scene([holding('check the build'), empty])

    await expect(verify(s, 'check the build')).resolves.toEqual({ kind: 'sent' })
  })

  it('never says not sent because the words are still in the input: a late Enter looks the same', async () => {
    // Orca writes the Enter before it acks, and a busy Claude can take it
    // seconds later. The words in the input are no evidence of a lost Enter.
    const s = scene([holding('check the build')])

    await expect(verify(s, 'check the build')).resolves.toEqual({ kind: 'unknown' })

    expect(s.clock()).toBeGreaterThanOrEqual(SUBMIT_VERIFY_WINDOW_MS)
    expect(
      s.readAt.slice(1).every((at, index) => at - s.readAt[index]! >= SUBMIT_LOOK_GAP_MS)
    ).toBe(true)
  })

  it('keeps waiting while the draft Orca published still holds the words', async () => {
    const s = scene([{ lines: composerWithTextInDraft(), draft: INCIDENT_MESSAGE }])

    await expect(verify(s, INCIDENT_MESSAGE)).resolves.toEqual({ kind: 'unknown' })
  })

  it('calls the send sent once the words are gone, whatever else the input shows (a prompt suggestion, text from the desk)', async () => {
    for (const other of [
      'run the tests',
      'Press up to edit queued messages',
      'Message @worker…',
      'typed at the desk'
    ]) {
      const s = scene([holding('check the build'), { lines: composerWithTextInRows(other) }])
      await expect(verify(s, 'check the build')).resolves.toEqual({ kind: 'sent' })
    }
  })

  it('compares the first stretch of the words, wrapped or not', async () => {
    const long = 'word '.repeat(80).trim()
    const s = scene([{ lines: composerWithTextInRows(long, 40) }])

    await expect(verify(s, long)).resolves.toEqual({ kind: 'unknown' })
  })

  it('says unknown, and holds the window open, when a dialog stands where the composer was', async () => {
    const dialog = {
      lines: ['⏺ Bash(ls)', '  Do you want to proceed?', '❯ 1. Yes', '  2. No', '  Esc to cancel']
    }
    const s = scene([dialog])

    await expect(verify(s, 'hello')).resolves.toEqual({ kind: 'unknown' })
    expect(s.clock()).toBeGreaterThanOrEqual(SUBMIT_VERIFY_WINDOW_MS)
  })

  it('says unverified, without waiting out the window, when no look can be had', async () => {
    const s = scene(['fail'])

    await expect(verify(s, 'hello')).resolves.toEqual({ kind: 'unverified' })

    expect(s.sendRequest).toHaveBeenCalledTimes(2)
    expect(s.clock()).toBeLessThan(SUBMIT_VERIFY_WINDOW_MS)
  })

  it('says unknown, not unverified, when one look was had and the rest failed', async () => {
    const s = scene([{ lines: ['⏺ Bash(ls)', '❯ 1. Yes'] }, 'fail'])

    await expect(verify(s, 'hello')).resolves.toEqual({ kind: 'unknown' })
  })

  it('sends a one-character message through as sent', async () => {
    const s = scene([empty])
    await expect(verify(s, 'y')).resolves.toEqual({ kind: 'sent' })
  })

  describe("with the hook beacon's prompt copy", () => {
    it("says sent from the agent's own copy of the words, before any look", async () => {
      const s = scene([holding('hello')])

      await expect(
        verify(s, 'hello', { receipts: () => [receipt('n2', 'hello')] })
      ).resolves.toEqual({ kind: 'sent' })

      expect(s.sendRequest).not.toHaveBeenCalled()
    })

    it('ignores an identical copy the beacon already held before the send', async () => {
      const s = scene([holding('hello')])

      await expect(
        verify(s, 'hello', {
          receipts: () => [receipt('n1', 'hello')],
          seenNonces: new Set(['n1'])
        })
      ).resolves.toEqual({ kind: 'unknown' })
    })

    it('ignores a copy of other words', async () => {
      const s = scene([holding('hello')])

      await expect(
        verify(s, 'hello', { receipts: () => [receipt('n2', 'goodbye')] })
      ).resolves.toEqual({ kind: 'unknown' })
    })

    it('takes a cut copy as the start of the words', async () => {
      const s = scene([holding('x')])
      const long = 'a long message '.repeat(30).trim()

      await expect(
        verify(s, long, { receipts: () => [receipt('n2', long.slice(0, 200), { cut: true })] })
      ).resolves.toEqual({ kind: 'sent' })
    })

    it('reads the beacon as it is when the look comes, not as it was at the start', async () => {
      const s = scene([holding('hello')])
      let seen: BeaconPromptReceipt[] = []
      const wait = async (ms: number) => {
        await s.wait(ms)
        if (s.clock() >= 450) {
          seen = [receipt('n2', 'hello')]
        }
      }

      await expect(verify(s, 'hello', { receipts: () => seen, wait })).resolves.toEqual({
        kind: 'sent'
      })
    })
  })
})
