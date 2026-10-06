import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import {
  forgetFileTabDoc,
  prefetchOutsideWorktreeFileTabs,
  prefetchedFileTabDoc,
  resetFileTabPrefetchForTests
} from './mobile-file-tab-prefetch'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8sm7wAAAABJRU5ErkJggg=='
const ABSOLUTE = '/private/tmp/claude-501/scratch/closed-tab.png'
const ok = (result: unknown): RpcResponse => ({ id: 'x', ok: true, result, _meta: { runtimeId: 'r' } })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// The prefetch reads a desktop-opened tab's file while a terminal still shows its path, and keeps
// what it read while the tab is open. A tab closed before that read finished must not get it back.
describe('the outside-worktree prefetch and a closed tab', () => {
  beforeEach(() => resetFileTabPrefetchForTests())

  it('keeps nothing for a tab closed while its prefetch was in flight', async () => {
    let vouch: (reply: RpcResponse) => void = () => {}
    const host = {
      sendRequest: (method: string) => {
        if (method === 'files.resolveTerminalPath') {
          return new Promise<RpcResponse>((resolve) => {
            vouch = resolve
          })
        }
        return Promise.resolve(ok({ isImage: true, mimeType: 'image/png', content: PNG }))
      }
    }
    prefetchOutsideWorktreeFileTabs(
      host as never,
      'wt1',
      [{ type: 'file', relativePath: ABSOLUTE }],
      ['term_agent']
    )
    forgetFileTabDoc('wt1', ABSOLUTE)
    vouch(
      ok({
        worktree: 'wt1',
        exists: true,
        isDirectory: false,
        openTarget: { kind: 'absolute-file', absolutePath: ABSOLUTE, grantId: 'g' }
      })
    )
    await flush()
    expect(prefetchedFileTabDoc('wt1', ABSOLUTE)).toBeNull()
  })
})
