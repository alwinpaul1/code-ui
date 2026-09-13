import { describe, expect, it } from 'vitest'
import { readMacHostPlatformResult, selectMacHostWorktreeId } from './mac-host-platform'
import type { HomeWorktreeSummary, HostWorktreeInfo } from '../worktree/home-worktree-info'

const WORKTREE: HomeWorktreeSummary = {
  worktreeId: 'wt-active',
  repo: 'repo',
  branch: 'main',
  displayName: 'repo',
  liveTerminalCount: 0
}

function info(lastActive: HomeWorktreeSummary | null): HostWorktreeInfo {
  return { hostId: 'host-1', totalWorktrees: 1, activeCount: 0, lastActiveWorktree: lastActive }
}

describe('knowing whether the host is a Mac', () => {
  it('takes the platform the host states', () => {
    expect(readMacHostPlatformResult({ platform: 'darwin' })).toBe('darwin')
    expect(readMacHostPlatformResult({ platform: 'win32' })).toBe('win32')
  })

  it('stays unknown rather than guessing when the host says nothing usable', () => {
    expect(readMacHostPlatformResult(null)).toBeNull()
    expect(readMacHostPlatformResult({})).toBeNull()
    expect(readMacHostPlatformResult({ platform: '' })).toBeNull()
    expect(readMacHostPlatformResult({ platform: 7 })).toBeNull()
  })
})

describe('choosing the workspace the command runs in', () => {
  it('prefers the workspace the host is actually on', () => {
    expect(selectMacHostWorktreeId(info(WORKTREE), [{ worktreeId: 'wt-other' }])).toBe('wt-active')
  })

  it('falls back to the first workspace the host has listed', () => {
    expect(selectMacHostWorktreeId(info(null), [{ worktreeId: 'wt-first' }, WORKTREE])).toBe(
      'wt-first'
    )
  })

  it('reports no workspace at all rather than an empty id', () => {
    expect(selectMacHostWorktreeId(undefined, null)).toBeNull()
    expect(selectMacHostWorktreeId(info(null), [{}, null])).toBeNull()
  })
})
