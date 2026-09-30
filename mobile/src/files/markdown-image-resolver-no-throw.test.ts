import { describe, expect, it, vi } from 'vitest'

/**
 * Whatever resolving a figure's path does, the resolver answers with a promise and never throws
 * out of its caller, which is a figure's effect. `![chart](100%.png)` threw URIError there and
 * took the document viewer down (review, 2026-09-30). The path helper is made to throw here so
 * this pins the resolver's own guard, not the helper's fix.
 */
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))
vi.mock('../components/markdown-image-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/markdown-image-source')>()),
  resolveMarkdownImagePath: () => {
    throw new URIError('URI malformed')
  }
}))

import { createMarkdownImageResolver } from './markdown-image-resolver'

describe('a figure whose path cannot be resolved', () => {
  it('is the link, answered as a promise, and never a throw out of the figure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const client = { sendRequest: vi.fn() }
      const resolve = createMarkdownImageResolver({
        client: client as never,
        worktreeId: 'wt',
        documentRelativePath: 'docs/README.md'
      })
      let answer: Promise<unknown> | null = null
      expect(() => {
        answer = resolve('100%.png')
      }).not.toThrow()
      await expect(answer).resolves.toBeNull()
      expect(client.sendRequest).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls[0])).toContain('URI malformed')
    } finally {
      warn.mockRestore()
    }
  })
})
