import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'
import {
  AFTER_REVIEW_NOTICE,
  composerWithTextInRows,
  EMPTY_COMPOSER,
  REVIEW_NOTICE
} from './fixtures/claude-composer-2.1.287'

// Photo sends, Claude Code 2.1.288. PROVENANCE. FROM THE 2.1.288 BINARY (`strings`,
// read, never run): a pasted image is drawn in the input as the chip literal
// `[Image #N]` (`f1e`: `[Image #${e}]`), and the sent turn's image component (`Ps`)
// draws the same literal. TRANSCRIBED from a real 2.1.281 screen
// (fixtures/claude-screen-sent-photos-2.1.281.txt): a submitted prompt that carries
// an image is a column-0 `❯` row with the literal in it ("❯ [Image #1] pasted in the
// terminal"). MODELLED, not captured: three chips side by side in one input row, the
// space (or none) between chips and caption, and a photo-only prompt row ("❯ [Image
// #1]"). A review notice over an input holding chips is modelled from the 2.1.287
// notice (`txe`); no live capture of one with photos exists.

type Look = { lines: string[]; draft?: string }

function scene(looks: readonly Look[]) {
  let now = 0
  let index = 0
  const sendRequest = vi.fn(async () => {
    const look = looks[Math.min(index, looks.length - 1)]!
    index += 1
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
    clock: () => now
  }
}

const chips = (n: number): string =>
  Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join('')

const verifyPhotos = (s: ReturnType<typeof scene>, text: string, extra = {}) =>
  verifyClaudeSubmit({
    client: s.client,
    terminal: 'term',
    text,
    images: true,
    seenNonces: new Set(),
    wait: s.wait,
    now: s.clock,
    ...extra
  })

const holding = (n: number, caption: string): Look => ({
  lines: composerWithTextInRows(`${chips(n)} ${caption}`.trim())
})
const empty: Look = { lines: EMPTY_COMPOSER }
const emptyWithEcho = (n: number, caption: string): Look => ({
  lines: [`❯ ${chips(n)} ${caption}`.trimEnd(), ...EMPTY_COMPOSER]
})

describe('checking that Claude took a photo send the host acked', () => {
  it("says not sent, with Claude's own words, when the review notice is up over the chips", async () => {
    const lines = AFTER_REVIEW_NOTICE.map((row) =>
      row.startsWith('  ') && row.includes('sudo') ? `  ${chips(3)} what is wrong here` : row
    )
    const s = scene([{ lines }])

    await expect(verifyPhotos(s, 'what is wrong here')).resolves.toEqual({
      kind: 'not-sent',
      message: `Not sent. Claude says: ${REVIEW_NOTICE}.`
    })
  })

  it('says sent for three photos and a caption once the prompt row is drawn and the input is empty', async () => {
    const s = scene([emptyWithEcho(3, 'what is wrong here')])

    await expect(verifyPhotos(s, 'what is wrong here')).resolves.toEqual({ kind: 'sent' })
  })

  it('says sent for one photo and no text once the chip was seen in the input and the input is empty', async () => {
    const s = scene([holding(1, ''), empty])

    await expect(verifyPhotos(s, '')).resolves.toEqual({ kind: 'sent' })
  })

  it('says unknown, not sent, for a photo-only send when the only sign is a chip-only prompt row: an earlier photo leaves the same row', async () => {
    const s = scene([emptyWithEcho(1, '')])

    await expect(verifyPhotos(s, '')).resolves.toEqual({ kind: 'unknown' })
  })

  it('does not call an empty input sent for a photo-only send when nothing was seen: a lagging Claude looks the same', async () => {
    const s = scene([empty])

    await expect(verifyPhotos(s, '')).resolves.toEqual({ kind: 'unknown' })
  })

  it('says unknown, never sent, while the chips and the caption are still in the input after the whole window', async () => {
    const s = scene([holding(3, 'what is wrong here')])

    await expect(verifyPhotos(s, 'what is wrong here')).resolves.toEqual({ kind: 'unknown' })
    expect(s.clock()).toBeGreaterThanOrEqual(4_500)
  })

  it('says unknown while a lone chip is still in the input of a photo-only send', async () => {
    const s = scene([holding(1, '')])

    await expect(verifyPhotos(s, '')).resolves.toEqual({ kind: 'unknown' })
  })

  it('does not take an older photo prompt row for this send when the caption differs', async () => {
    const s = scene([emptyWithEcho(2, 'an earlier caption')])

    await expect(verifyPhotos(s, 'this caption')).resolves.toEqual({ kind: 'unknown' })
  })
})
