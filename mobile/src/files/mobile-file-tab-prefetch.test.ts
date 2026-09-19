import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import {
  prefetchOutsideWorktreeFileTabs,
  prefetchedFileTabDoc,
  rememberFileTabDoc,
  resetFileTabPrefetchForTests
} from './mobile-file-tab-prefetch'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8sm7wAAAABJRU5ErkJggg=='
const ABSOLUTE = '/private/tmp/claude-501/scratch/fstrip2.png'
const ok = (result: unknown): RpcResponse => ({ id: 'x', ok: true, result, _meta: { runtimeId: 'r' } })

function hostThatVouchesUntil(deadline: number, clock: { now: number }) {
  const calls: string[] = []
  return {
    calls,
    sendRequest: (method: string) => {
      calls.push(method)
      if (method === 'files.resolveTerminalPath') {
        return Promise.resolve(
          ok(
            clock.now <= deadline
              ? { worktree: 'wt1', exists: true, isDirectory: false, openTarget: { kind: 'absolute-file', absolutePath: ABSOLUTE, grantId: 'g' } }
              : { worktree: 'wt1', relativePath: null, absolutePath: ABSOLUTE, exists: false, isDirectory: false }
          )
        )
      }
      if (method === 'files.readTerminalArtifactPreview') {
        return Promise.resolve(ok({ isImage: true, mimeType: 'image/png', content: PNG }))
      }
      return Promise.reject(new Error(`unexpected ${method}`))
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a desktop-opened file outside the worktree, read while a terminal still shows its path', () => {
  beforeEach(() => resetFileTabPrefetchForTests())
  afterEach(() => resetFileTabPrefetchForTests())

  it('is read when its tab first appears, and served later when no terminal vouches for it any more', async () => {
    // Device 2026-09-19: the agent printed the path in the morning, the
    // desktop opened it, the phone opened the tab hours later and the
    // host's terminal window (last 1024 lines) had long moved on.
    const clock = { now: 1000 }
    const host = hostThatVouchesUntil(5000, clock)
    const tabs = [{ type: 'file', relativePath: ABSOLUTE }]
    prefetchOutsideWorktreeFileTabs(host as never, 'wt1', tabs, ['term_agent'], clock.now)
    await flush()
    expect(host.calls).toEqual(['files.resolveTerminalPath', 'files.readTerminalArtifactPreview'])
    clock.now = 4_000_000
    expect(prefetchedFileTabDoc('wt1', ABSOLUTE)).toMatchObject({ kind: 'image' })
    // Seen again: nothing more is asked of the host.
    prefetchOutsideWorktreeFileTabs(host as never, 'wt1', tabs, ['term_agent'], clock.now)
    await flush()
    expect(host.calls).toHaveLength(2)
  })

  it('retries a read the host refused a few times, then leaves it to the tab', async () => {
    const clock = { now: 10_000 }
    const host = hostThatVouchesUntil(0, clock)
    const tabs = [{ type: 'file', relativePath: ABSOLUTE }]
    for (let i = 0; i < 10; i += 1) {
      prefetchOutsideWorktreeFileTabs(host as never, 'wt1', tabs, ['t1'], clock.now)
      await flush()
      clock.now += 60_000
    }
    // Each attempt resolves against the one terminal, then without one.
    expect(host.calls.filter((c) => c === 'files.resolveTerminalPath')).toHaveLength(8)
    expect(prefetchedFileTabDoc('wt1', ABSOLUTE)).toBeNull()
  })

  it('leaves worktree files, diffs and other tab types alone', async () => {
    const clock = { now: 1 }
    const host = hostThatVouchesUntil(9, clock)
    prefetchOutsideWorktreeFileTabs(
      host as never,
      'wt1',
      [
        { type: 'file', relativePath: 'src/app.ts' },
        { type: 'file', relativePath: ABSOLUTE, diffSource: 'staged' },
        { type: 'markdown', relativePath: ABSOLUTE },
        { type: 'terminal' }
      ],
      ['t1'],
      clock.now
    )
    await flush()
    expect(host.calls).toEqual([])
  })

  it('keeps a bounded number of documents and refuses an oversized one', () => {
    for (let i = 0; i < 20; i += 1) {
      rememberFileTabDoc('wt1', `/tmp/${i}.txt`, { status: 'ready', kind: 'file', content: 'x', truncated: false, byteLength: 1 })
    }
    expect(prefetchedFileTabDoc('wt1', '/tmp/0.txt')).toBeNull()
    expect(prefetchedFileTabDoc('wt1', '/tmp/19.txt')).not.toBeNull()
    rememberFileTabDoc('wt1', '/tmp/huge.png', { status: 'ready', kind: 'image', dataUri: 'x'.repeat(9 * 1024 * 1024) })
    expect(prefetchedFileTabDoc('wt1', '/tmp/huge.png')).toBeNull()
  })
})
