import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import {
  browseClaudeSkills,
  resetConfirmedSkillFilesForTest
} from './mobile-native-chat-skill-browse-load'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'

/**
 * The `/` menu on a host that refuses skills.discover (Orca 1.4.205, this user's setup), when the
 * directory walk that stands in for it starts while the link is down. Every listing failed, the
 * walk returned with nothing, and it was stamped as walked when it STARTED, so every later `/`
 * skipped the walk for ten minutes: built-ins only, over a link that had come back, because the
 * logical client is the same object across reconnects (review, 2026-09-30).
 */

const HOME = '/Users/alwinpaul'
const WORKTREE = 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI'

function refused(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'r' } }
}

const listings: Record<string, { name: string; isDirectory: boolean; isSymlink: boolean }[]> = {
  '': [{ name: '.claude', isDirectory: true, isSymlink: false }],
  [`${HOME}/.claude/skills`]: [{ name: 'my-skill', isDirectory: true, isSymlink: false }],
  [`${HOME}/.claude/skills/my-skill`]: [{ name: 'SKILL.md', isDirectory: false, isSymlink: false }]
}

const link = { up: true }

const client = {
  sendRequest: vi.fn(async (method: string, params?: unknown): Promise<RpcResponse> => {
    if (method === 'skills.discover') {
      return refused('forbidden', "Method 'skills.discover' is not available to mobile clients")
    }
    if (method === 'files.browseServerDir') {
      if (!link.up) {
        throw new Error('Not connected')
      }
      const path = (params as { path: string }).path
      const entries = listings[path]
      if (!entries) {
        return refused('not_found', `ENOENT ${path}`)
      }
      return {
        id: 'rpc',
        ok: true,
        result: { resolvedPath: path || HOME, entries },
        _meta: { runtimeId: 'r' }
      }
    }
    return refused('method_not_found', method)
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  link.up = true
  client.sendRequest.mockClear()
  resetConfirmedSkillFilesForTest()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the / menu’s skills after a walk that started while the link was down', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: { nativeChatSkills: { name: string }[]; loadNativeChatSkills: () => void } | null =
    null

  function Probe(): null {
    latest = useMobileNativeChatSkills({
      client: client as never,
      worktreeId: WORKTREE,
      chatIdentity: null
    })
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
  })

  async function openMenu(): Promise<void> {
    await act(async () => {
      latest!.loadNativeChatSkills()
      await settle()
    })
  }

  it('walks again on the next / once the link is back, instead of built-ins only for ten minutes', async () => {
    link.up = false
    act(() => {
      renderer = create(createElement(Probe))
    })
    await openMenu()
    expect(latest!.nativeChatSkills).toEqual([])
    link.up = true
    await openMenu()
    expect(latest!.nativeChatSkills.map((skill) => skill.name)).toEqual(['my-skill'])
  })

  it('lists the skills on the first / when the link never went down', async () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    await openMenu()
    expect(latest!.nativeChatSkills.map((skill) => skill.name)).toEqual(['my-skill'])
  })

  it('does not walk again within the ten minutes after a walk that reached the home folder', async () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    await openMenu()
    const walked = client.sendRequest.mock.calls.length
    await openMenu()
    const browses = client.sendRequest.mock.calls
      .slice(walked)
      .filter((call) => call[0] === 'files.browseServerDir')
    expect(browses).toEqual([])
  })
})

describe('what one directory walk reports', () => {
  it('says it never reached the home folder, and why, when the home listing fails', async () => {
    link.up = false
    const reached = await browseClaudeSkills({
      client: client as never,
      worktreePath: null,
      claudeConfigDir: null,
      onSkills: () => undefined,
      live: () => true
    })
    expect(reached).toBe(false)
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    expect(JSON.stringify(warned[0])).toContain('Not connected')
  })

  it('says it reached the home folder when the home listing answers', async () => {
    const reached = await browseClaudeSkills({
      client: client as never,
      worktreePath: null,
      claudeConfigDir: null,
      onSkills: () => undefined,
      live: () => true
    })
    expect(reached).toBe(true)
  })
})
