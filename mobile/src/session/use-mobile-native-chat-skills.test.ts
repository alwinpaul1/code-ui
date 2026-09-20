import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'
import { resetConfirmedSkillFilesForTest } from './mobile-native-chat-skill-browse-load'

function Harness(props: {
  client: Pick<RpcClient, 'sendRequest'>
  onLoad: (load: () => void) => void
}): null {
  const { loadNativeChatSkills } = useMobileNativeChatSkills({ client: props.client, worktreeId: 'w1' })
  props.onLoad(loadNativeChatSkills)
  return null
}

function refused(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'r' } }
}

describe('the / menu’s skills list on a host that refuses skills.discover', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function openMenuTwiceAcrossTheStaleWindow(reply: RpcResponse): Promise<number> {
    vi.useFakeTimers()
    const sendRequest = vi.fn(async () => reply)
    const loads: (() => void)[] = []
    act(() => {
      renderer = create(createElement(Harness, { client: { sendRequest }, onLoad: (load) => loads.push(load) }))
    })
    await act(async () => {
      loads[0]!()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Past SKILLS_STALE_MS, and past the 2 s prime the chat fires on its own:
    // a host that answered would be asked again here, once, by whichever of
    // the two comes first.
    await act(async () => {
      vi.advanceTimersByTime(4_000)
      loads[0]!()
      await Promise.resolve()
    })
    // Only the scan itself: a refusal now also starts the directory-listing
    // fallback, whose calls are its own (see the describe below).
    return sendRequest.mock.calls.filter((call) => call[0] === 'skills.discover').length
  }

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses
  // skills.discover from a phone. The hook latched only method_not_found, so
  // every `/` re-asked the host for an answer that could not change.
  it('asks once and stops when the mobile gate refuses, the way it already stops for an old host', async () => {
    expect(
      await openMenuTwiceAcrossTheStaleWindow(
        refused('forbidden', "Method 'skills.discover' is not available to mobile clients")
      )
    ).toBe(1)
  })

  it('still asks once and stops for a host too old to know the method', async () => {
    expect(await openMenuTwiceAcrossTheStaleWindow(refused('method_not_found', 'Unknown method: skills.discover'))).toBe(1)
  })

  it('does ask again after a refusal that could change, such as a busy host', async () => {
    expect(await openMenuTwiceAcrossTheStaleWindow(refused('runtime_busy', 'try again'))).toBe(2)
  })
})

// 2026-09-20, phone beside the Claude app: typing `/` on the phone listed
// the curated built-ins and none of the user's skills; the Claude app lists
// every one (`/academic-research-writer`, `/agents-sdk`, `/typesafe:typesafe-ai`…).
// The host's scan is refused to a phone on Orca 1.4.205; directory listing is
// not, and Claude Code's skills are directories.
describe('the / menu’s skills list, read by directory when the scan is refused', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const HOME = '/Users/alwinpaul'
  const dir = (name: string) => ({ name, isDirectory: true, isSymlink: false })
  const file = (name: string) => ({ name, isDirectory: false, isSymlink: false })
  const listings: Record<string, ReturnType<typeof dir>[]> = {
    '': [dir('.claude'), dir('Desktop')],
    [`${HOME}/.claude/skills`]: [
      dir('_sources'),
      dir('academic-researcher'),
      dir('android-reverse-engineering-skill'),
      { name: 'animation-vocabulary', isDirectory: false, isSymlink: true },
      { name: 'dangling-link', isDirectory: false, isSymlink: true }
    ],
    [`${HOME}/.claude/skills/academic-researcher`]: [file('SKILL.md')],
    // A folder without SKILL.md is not a skill; Claude Code skips it.
    [`${HOME}/.claude/skills/android-reverse-engineering-skill`]: [file('README.md')],
    // A symlink to a skill folder lists like the folder it points at.
    [`${HOME}/.claude/skills/animation-vocabulary`]: [file('SKILL.md')],
    // `dangling-link` has no listing: a link to nothing, or to a file.
    [`${HOME}/.claude/plugins/cache`]: [dir('typesafe-ai'), file('blocklist.json')],
    [`${HOME}/.claude/plugins/cache/typesafe-ai`]: [dir('typesafe')],
    [`${HOME}/.claude/plugins/cache/typesafe-ai/typesafe`]: [dir('0.5.7')],
    [`${HOME}/.claude/plugins/cache/typesafe-ai/typesafe/0.5.7/skills`]: [dir('typesafe-ai')]
  }
  function browsingClient(): { sendRequest: ReturnType<typeof vi.fn> } {
    const sendRequest = vi.fn(async (method: string, params?: unknown): Promise<RpcResponse> => {
      if (method === 'skills.discover') {
        return refused('forbidden', "Method 'skills.discover' is not available to mobile clients")
      }
      if (method === 'files.browseServerDir') {
        const path = (params as { path: string }).path
        const entries = listings[path]
        if (!entries) {
          return refused('not_found', `ENOENT ${path}`)
        }
        return { id: 'rpc', ok: true, result: { resolvedPath: path || HOME, entries }, _meta: { runtimeId: 'r' } }
      }
      return refused('method_not_found', method)
    })
    return { sendRequest }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 40; i += 1) {
      await Promise.resolve()
    }
  }

  it('lists the home skills and cached plugin skills the Claude app lists, and drops a folder with no SKILL.md', async () => {
    const client = browsingClient()
    let latest: { nativeChatSkills: { name: string; sourceLabel: string }[]; loadNativeChatSkills: () => void } | null = null
    function Probe(): null {
      latest = useMobileNativeChatSkills({
        client: client as never,
        worktreeId: 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI'
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    await act(async () => {
      latest!.loadNativeChatSkills()
      await settle()
    })
    expect(latest!.nativeChatSkills.map((s) => `${s.sourceLabel}:${s.name}`)).toEqual([
      'Home skills:academic-researcher',
      'Home skills:animation-vocabulary',
      'Claude plugin typesafe:typesafe-ai'
    ])
    // The repo roots were asked for too, and their absence was tolerated.
    const asked = client.sendRequest.mock.calls
      .filter((call) => call[0] === 'files.browseServerDir')
      .map((call) => (call[1] as { path: string }).path)
    expect(asked).toContain('/Users/alwinpaul/Desktop/Project/Code UI/.claude/skills')
  })

// 2026-09-20: "/anim" typed a second after a tab opened showed no card. The
// browse reported nothing until the plugin cache's forty listings were in.
  it('reports the home skills before the plugin cache has been walked, and keeps the last list across a reconnect', async () => {
  const client = browsingClient()
  let latest: { nativeChatSkills: { name: string }[]; loadNativeChatSkills: () => void } | null = null
  function Probe({ token }: { token: number }): null {
    latest = useMobileNativeChatSkills({
      client: (token === 1 ? client : { sendRequest: client.sendRequest }) as never,
      worktreeId: 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI'
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe, { token: 1 }))
  })
  await act(async () => {
    latest!.loadNativeChatSkills()
    // Enough ticks for the refusal, the home listing and the four roots — not the plugin walk.
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
    }
  })
  expect(latest!.nativeChatSkills.map((s) => s.name)).toContain('academic-researcher')
  await act(async () => {
    await settle()
  })
  expect(latest!.nativeChatSkills.map((s) => s.name)).toContain('typesafe-ai')
  // A new client object (reconnect): the list is not blanked.
  act(() => renderer!.update(createElement(Probe, { token: 2 })))
  expect(latest!.nativeChatSkills.map((s) => s.name)).toContain('typesafe-ai')
})

  // 2026-09-20, device recording: typing right after the `/` that started a
  // directory walk lagged by seconds and dropped characters. Every walk asked
  // the host about all 215 skill folders again. Once per launch is enough.
  // 2026-09-20, phone recording: the walk started at the first `/` of a
  // launch, so its replies shared the JS thread with the controlled input
  // while the user typed, and the next keys landed two seconds late in one
  // lump. The walk belongs before the typing, not under it.
  it('starts when the chat opens, so the first / of a launch finds the list already read', async () => {
    resetConfirmedSkillFilesForTest()
    vi.useFakeTimers()
    const client = browsingClient()
    function Probe(): null {
      useMobileNativeChatSkills({
        client: client as never,
        worktreeId: 'w-prime::/Users/alwinpaul/Desktop/Project/Code UI'
      })
      return null
    }
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(client.sendRequest).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(2_000)
      for (let i = 0; i < 60; i += 1) {
        await Promise.resolve()
      }
    })
    const methods = client.sendRequest.mock.calls.map((call) => call[0])
    expect(methods.filter((method) => method === 'skills.discover')).toHaveLength(1)
    expect(methods.filter((method) => method === 'files.browseServerDir').length).toBeGreaterThan(0)
    act(() => renderer!.unmount())
    vi.useRealTimers()
  })

  describe('the SKILL.md confirmations', () => {
    it('are asked once per launch, not on every walk', async () => {
      resetConfirmedSkillFilesForTest()
      const client = browsingClient()
      const asks = () =>
        client.sendRequest.mock.calls.filter(
          (call) => call[0] === 'files.browseServerDir' && String((call[1] as { path: string }).path).endsWith('/academic-researcher')
        ).length
      let latest: { loadNativeChatSkills: () => void } | null = null
      function Probe({ token }: { token: number }): null {
        latest = useMobileNativeChatSkills({
          client: (token === 1 ? client : { sendRequest: client.sendRequest }) as never,
          worktreeId: 'w-confirm::/Users/alwinpaul/Desktop/Project/Code UI'
        })
        return null
      }
      let renderer: ReactTestRenderer | null = null
      act(() => {
        renderer = create(createElement(Probe, { token: 1 }))
      })
      await act(async () => {
        latest!.loadNativeChatSkills()
        for (let i = 0; i < 60; i += 1) {
          await Promise.resolve()
        }
      })
      expect(asks()).toBe(1)
      // A reconnect walks again; the confirmation is remembered.
      act(() => renderer!.update(createElement(Probe, { token: 2 })))
      await act(async () => {
        latest!.loadNativeChatSkills()
        for (let i = 0; i < 60; i += 1) {
          await Promise.resolve()
        }
      })
      expect(asks()).toBe(1)
      act(() => renderer!.unmount())
    })
  })
})
