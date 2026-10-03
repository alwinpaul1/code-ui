import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import { IMAGE_CHIPS_MISSING, settleAfterImagePaste } from './mobile-native-chat-image-send-settle'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'

// Claude Code 2.1.288: a pasted image is the chip `[Image #N]` (binary, `f1e`). At phone width
// (about 45 columns) four chips take 43 characters and Claude's word wrap can break the fourth
// at its inner space, so the input's rows read `[Image` and `#4]`. MODELLED, not captured: the
// wrap column and which chip it lands in; the rows are joined with a newline as
// readClaudeInput joins them.

function screenWith(inputRows: string[]): string[] {
  const at = EMPTY_COMPOSER.findIndex((row) => row.trim() === '❯')
  return [
    ...EMPTY_COMPOSER.slice(0, at),
    `❯ ${inputRows[0]}`,
    ...inputRows.slice(1).map((row) => `  ${row}`),
    ...EMPTY_COMPOSER.slice(at + 1)
  ]
}
const clientShowing = (lines: string[]): RpcClient =>
  ({
    getState: () => 'connected',
    sendRequest: async () => ({
      id: 'r', ok: true, result: { terminal: { tail: lines, source: 'screen', draft: '' } }, _meta: { runtimeId: 'r' }
    })
  }) as unknown as RpcClient

const WRAPPED: [string, string[]][] = [
  ['on one row', ['[Image #1] [Image #2] [Image #3] [Image #4]']],
  ['wrapped between chips', ['[Image #1] [Image #2] [Image #3]', '[Image #4]']],
  ['wrapped inside a chip, at its inner space', ['[Image #1] [Image #2] [Image #3] [Image', '#4]']]
]

describe('the wait for every chip before a photo send types its caption', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settle = async (rows: string[], expected: number, agent = 'claude') => {
    const settling = settleAfterImagePaste({
      client: clientShowing(screenWith(rows)), terminal: 't', agent, expected,
      deadline: Date.now() + 15_000, sleep: async () => {}
    })
    await vi.advanceTimersByTimeAsync(10_000)
    return settling
  }

  it.each(WRAPPED)('counts all four chips %s', async (_name, rows) => {
    expect((await settle(rows, 4)).refusal).toBeNull()
  })

  it('refuses, saying the photos did not attach, when only three of four chips are in the input', async () => {
    expect((await settle(['[Image #1] [Image #2] [Image #3]'], 4)).refusal).toBe(IMAGE_CHIPS_MISSING)
  })

  it('refuses, restoring the draft, when Claude draws no chip: it could not read the image and typed the path as text', async () => {
    expect((await settle(['/tmp/a.png'], 1)).refusal).toBe(IMAGE_CHIPS_MISSING)
  })

  it('goes on at the fixed beat for Codex, which draws no chip', async () => {
    expect((await settle(['/tmp/a.png'], 1, 'codex')).refusal).toBeNull()
  })
})

describe('telling a four-photo send with a caption apart from a lost Enter when a chip is wrapped', () => {
  it.each(WRAPPED)('calls the send sent once the prompt row is drawn, chips %s', async (_name, rows) => {
    const sentRow = [`❯ ${rows.join(' ')} what is wrong here`, ...EMPTY_COMPOSER]
    const verdict = await verifyClaudeSubmit({
      client: clientShowing(sentRow), terminal: 't', text: 'what is wrong here', images: true,
      seenNonces: new Set(), wait: async () => {}, now: (() => { let t = 0; return () => (t += 700) })()
    })
    expect(verdict).toEqual({ kind: 'sent' })
  })

  it('calls the send sent when the wrapped chips were seen in the input and it is then empty', async () => {
    const looks = [screenWith([...WRAPPED[2]![1].slice(0, -1), '#4] what is wrong here']), EMPTY_COMPOSER]
    let at = 0
    const client = {
      sendRequest: async () => ({
        id: 'r', ok: true, result: { terminal: { tail: looks[Math.min(at++, 1)], source: 'screen', draft: '' } }
      })
    } as unknown as RpcClient
    let t = 0
    const verdict = await verifyClaudeSubmit({
      client, terminal: 't', text: 'what is wrong here', images: true, seenNonces: new Set(),
      wait: async () => {}, now: () => (t += 700)
    })
    expect(verdict).toEqual({ kind: 'sent' })
  })
})
