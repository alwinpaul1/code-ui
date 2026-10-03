import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { writeChatSend } from './mobile-native-chat-send-write'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { REVIEW_NOTICE, EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'

// Photo sends: the pasted chips are already in the input when the text and Enter go
// (use-mobile-native-chat-image-attachments.ts), so the send writes no clear and
// then checks, as a text send does, that Claude took it. Screens are MODELLED from
// the 2.1.288 chip literal `[Image #N]`; see mobile-native-chat-submit-verify-photos.test.ts.

const RULE = '─'.repeat(190)
const CAPTION = 'what is wrong with these screens'
const withChips = (n: number, caption: string): string[] => [
  '⏺ Done.',
  RULE,
  `❯ ${Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join('')} ${caption}`.trimEnd(),
  RULE,
  '  ⏵⏵ auto mode on (shift+tab to cycle)'
]
const noticeOver = (lines: string[]): string[] => {
  const at = lines.indexOf(RULE)
  return [...lines.slice(0, at), `${' '.repeat(100)}${REVIEW_NOTICE}`, ...lines.slice(at)]
}

function host(screens: readonly string[][]) {
  const sends: { text: string; enter: boolean }[] = []
  let reads = 0
  const sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
    if (method === 'terminal.send') {
      sends.push({ text: params.text ?? '', enter: params.enter === true })
      return { id: 's', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'r' } }
    }
    const tail = screens[Math.min(reads, screens.length - 1)]!
    reads += 1
    return { id: 'r', ok: true, result: { terminal: { source: 'screen', tail, draft: '' } } }
  })
  return { client: { sendRequest, getState: () => 'connected' } as unknown as RpcClient, sends, reads: () => reads }
}

const sendPhotos = (
  h: ReturnType<typeof host>,
  text: string,
  agent: 'claude' | 'codex' = 'claude'
) =>
  writeChatSend({
    agent,
    client: h.client,
    terminal: 'term',
    text,
    hasImages: true,
    syncComposer: true,
    classification: 'chat',
    typesCodexCommand: false,
    seed: null,
    residue: null,
    deadline: Date.now() + 20_000,
    deviceToken: null,
    receipts: () => []
  })

describe('a photo send is checked after its Enter, like a text send', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(() => vi.useRealTimers())

  async function run(p: Promise<unknown>) {
    await vi.runAllTimersAsync()
    return p
  }

  it('stops, with Claude\'s words, when its review notice stands over the photos and the caption', async () => {
    const h = host([noticeOver(withChips(3, CAPTION))])
    const result = await run(sendPhotos(h, CAPTION))

    expect(result).toEqual({
      kind: 'stopped',
      message: `Not sent. Claude says: ${REVIEW_NOTICE}.`
    })
    // Nothing is typed or pressed again after the notice.
    expect(h.sends.filter((s) => s.enter)).toHaveLength(1)
  })

  it('writes no clear of its own: the paste ahead of it did that', async () => {
    const h = host([[...withChips(1, ''), ...EMPTY_COMPOSER]])
    await run(sendPhotos(h, ''))

    expect(h.sends.some((s) => s.text.includes('\x15'))).toBe(false)
  })

  it('reports it held, not sent, when the chips and the caption stay in the input', async () => {
    const h = host([withChips(3, CAPTION)])
    const result = await run(sendPhotos(h, CAPTION))

    expect(result).toEqual({ kind: 'written', outcome: 'unknown' })
  })

  it('reports it sent for one photo and no text once the chip left the input', async () => {
    const h = host([withChips(1, ''), [...EMPTY_COMPOSER]])
    const result = await run(sendPhotos(h, ''))

    expect(result).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('reports it sent for three photos and a caption once the prompt is drawn above an empty input', async () => {
    const h = host([[`❯ [Image #1][Image #2][Image #3] ${CAPTION}`, ...EMPTY_COMPOSER]])
    const result = await run(sendPhotos(h, CAPTION))

    expect(result).toEqual({ kind: 'written', outcome: 'accepted' })
  })

  it('claims no more for Codex than the host ack: it has no submit check and reads no screen', async () => {
    const h = host([noticeOver(withChips(3, CAPTION))])
    const result = await run(sendPhotos(h, CAPTION, 'codex'))

    expect(result).toEqual({ kind: 'written', outcome: 'accepted' })
    expect(h.reads()).toBe(0)
  })
})
