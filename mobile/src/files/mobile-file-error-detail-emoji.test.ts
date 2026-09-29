import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { previewError } from './mobile-file-preview-response'
import { failureReason } from './mobile-file-read-failure-reason'
import { saveDesktopFileToPhone, type MobileFileSaveTarget } from './mobile-file-save'

// A failed read, preview or save keeps the raw error's first 140 UTF-16 code
// units, the only clue when a path fails on a host this build was not tested
// against. Error text names paths, and a path can hold an emoji: two code
// units, and a cut between them drew half of it, a broken glyph, at the end of
// the error line.
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const ROCKET = '🚀'
const HEAD = "EACCES: permission denied, open '/Users/alwin/Documents/"

/** An EACCES naming a folder padded so the rocket starts on code unit `index`. */
function eaccesWithRocketAt(index: number): string {
  return `${HEAD}${'x'.repeat(index - HEAD.length)}${ROCKET} launch/notes.md'`
}

/** What each surface shows for `message`, reduced to the raw detail it quotes. */
const SURFACES: [string, (message: string) => Promise<string>][] = [
  ['a whole-file read', async (message) => failureReason(message)],
  [
    'a file preview',
    async (message) => {
      const result = previewError(message)
      const shown = result.status === 'error' ? result.message : ''
      return shown.replace(/^Unable to load preview: /, '')
    }
  ],
  [
    'a save to the phone',
    async (message) => {
      const outcome = await saveWithWriteError(message)
      const shown = outcome.status === 'failed' ? outcome.message : ''
      return shown.replace(/^Couldn't save a\.txt: the phone could not write it \(/, '').replace(/\)$/, '')
    }
  ]
]

/** A desktop holding a.txt, answering files.readChunk the way Orca does
 *  (mobile-file-save.test.ts), and a phone whose write into the picked file
 *  throws `message`. */
function saveWithWriteError(message: string) {
  const bytes = Buffer.from('hello')
  const host = {
    sendRequest: vi.fn(async (_method: string, params: Record<string, unknown>): Promise<RpcResponse> => {
      const offset = params.offset as number
      const slice = bytes.subarray(offset, offset + (params.length as number))
      return {
        id: '1',
        ok: true,
        result: {
          contentBase64: slice.toString('base64'),
          bytesRead: slice.length,
          eof: offset + slice.length >= bytes.length
        },
        _meta: { runtimeId: 'runtime-1' }
      }
    })
  } as unknown as MobileFilePreviewRpcSender
  const target: MobileFileSaveTarget = {
    createDocument: async () => 'content://downloads/document/7',
    writeBase64: async () => {
      throw new Error(message)
    },
    remove: async () => undefined
  }
  return saveDesktopFileToPhone(
    host,
    { source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'a.txt' } },
    target
  )
}

describe.each(SURFACES)('the error detail of %s with an emoji at the 140-character cap', (_surface, detailOf) => {
  it('keeps a rocket emoji whole when it straddles the cut', async () => {
    const detail = await detailOf(eaccesWithRocketAt(139))
    expect(detail).not.toMatch(LONE_HALF)
    expect(detail).toBe(eaccesWithRocketAt(139).slice(0, 139))
  })

  it('keeps an emoji that ends just before the cut', async () => {
    const detail = await detailOf(eaccesWithRocketAt(138))
    expect(detail).toBe(eaccesWithRocketAt(138).slice(0, 140))
    expect(detail.endsWith(ROCKET)).toBe(true)
  })

  it('keeps a detail of exactly 140 code units whole, and cuts one a unit over', async () => {
    const exact = `${HEAD}${'x'.repeat(138 - HEAD.length)}${ROCKET}`
    expect(exact).toHaveLength(140)
    expect(await detailOf(exact)).toBe(exact)
    const over = await detailOf(`${HEAD}${'x'.repeat(139 - HEAD.length)}${ROCKET}`)
    expect(over).not.toMatch(LONE_HALF)
    expect(over).toBe(`${HEAD}${'x'.repeat(139 - HEAD.length)}`)
  })

  it('cuts a detail made only of emoji between two of them', async () => {
    const detail = await detailOf(`✅${ROCKET.repeat(80)}`)
    expect(detail).not.toMatch(LONE_HALF)
    expect(detail).toBe(`✅${ROCKET.repeat(69)}`)
  })
})

// The empty message: each surface says so in words instead of quoting nothing.
describe('an error with no message at all', () => {
  it('reads as a plain sentence on every surface', async () => {
    expect(failureReason('')).toBe('the desktop gave no reason')
    expect(previewError('')).toEqual({ status: 'error', message: 'Unable to load preview', reconnect: false })
    const saved = await saveWithWriteError('')
    expect(saved.status === 'failed' ? saved.message : '').toBe(
      "Couldn't save a.txt: the phone could not write it (no reason given)"
    )
  })
})
