import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileNativeChatSkills, type SkillsMenuChat } from './use-mobile-native-chat-skills'
import { resetConfirmedSkillFilesForTest } from './mobile-native-chat-skill-browse-load'

function Harness(props: {
  client: Pick<RpcClient, 'sendRequest'>
  onLoad: (load: () => void) => void
}): null {
  const { loadNativeChatSkills } = useMobileNativeChatSkills({
    client: props.client,
    worktreeId: 'w1',
    chatIdentity: null
  })
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
    const sendRequest = vi.fn(async (_method: string, _params?: unknown) => reply)
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
    [`${HOME}/.claude/commands`]: [file('deploy.md')],
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
        worktreeId: 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI',
        chatIdentity: null
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
      'Home commands:deploy',
      'Claude plugin typesafe:typesafe-ai'
    ])
    // The repo roots were asked for too, and their absence was tolerated.
    const asked = client.sendRequest.mock.calls
      .filter((call) => call[0] === 'files.browseServerDir')
      .map((call) => (call[1] as { path: string }).path)
    expect(asked).toContain('/Users/alwinpaul/Desktop/Project/Code UI/.claude/skills')
  })

  it('keeps a command file that exists, instead of dropping it for lack of SKILL.md', async () => {
    resetConfirmedSkillFilesForTest()
    const client = browsingClient()
    let latest: { nativeChatSkills: { name: string; sourceLabel: string }[]; loadNativeChatSkills: () => void } | null = null
    function Probe(): null {
      latest = useMobileNativeChatSkills({
        client: client as never,
        worktreeId: 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI',
        chatIdentity: null
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
    expect(latest!.nativeChatSkills.map((skill) => `${skill.sourceLabel}:${skill.name}`)).toContain(
      'Home commands:deploy'
    )
  })

// 2026-09-20: "/anim" typed a second after a tab opened showed no card. The
// browse reported nothing until the plugin cache's forty listings were in.
  it('reports the home skills before the plugin cache has been walked, and keeps the last list across a reconnect', async () => {
  const client = browsingClient()
  let latest: { nativeChatSkills: { name: string }[]; loadNativeChatSkills: () => void } | null = null
  function Probe({ token }: { token: number }): null {
    latest = useMobileNativeChatSkills({
      client: (token === 1 ? client : { sendRequest: client.sendRequest }) as never,
      worktreeId: 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI',
      chatIdentity: null
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
        worktreeId: 'w-prime::/Users/alwinpaul/Desktop/Project/Code UI',
        chatIdentity: null
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
          worktreeId: 'w-confirm::/Users/alwinpaul/Desktop/Project/Code UI',
          chatIdentity: null
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


// 2026-09-25: this machine runs Claude Code with CLAUDE_CONFIG_DIR=~/.claude-work,
// and Claude Code 2.1.282 loads a session's skills, commands and plugins from
// that dir alone. The phone listed ~/.claude/skills and ~/.claude/plugins/cache
// for every session: 27 skills a ~/.claude-work session cannot run
// (`/notebooklm` among them), and none of the plugins only ~/.claude-work has
// (`/claude-security:claude-security`). The names below are real, from both
// profiles on this machine.
describe('the / menu lists the skills of the Claude profile its session runs under', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const HOME = '/Users/alwinpaul'
  const WORKTREE = 'a91672c3::/Users/alwinpaul/Desktop/Project/Code UI'
  const WORK_TRANSCRIPT =
    `${HOME}/.claude-work/projects/-Users-alwinpaul-Desktop-Project-Code-UI/` +
    '967668df-a7d9-40e7-964b-7812815c010d.jsonl'
  const HOME_TRANSCRIPT =
    `${HOME}/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/a10fe5ce-0066-4188-b686-bb6062c3d4d9.jsonl`
  const CODEX_ROLLOUT =
    `${HOME}/.codex/sessions/2026/09/11/rollout-2026-09-11T02-42-13-01a08dea-3c89-78e0-b629-04a87f33c43e.jsonl`
  /** A Claude chat, and the transcript its hook reported (null before it has). */
  const claude = (transcriptPath: string | null): SkillsMenuChat => ({ agent: 'claude', transcriptPath })
  const dir = (name: string) => ({ name, isDirectory: true, isSymlink: false })
  const file = (name: string) => ({ name, isDirectory: false, isSymlink: false })
  const listings: Record<string, ReturnType<typeof dir>[]> = {
    '': [dir('.claude'), dir('.claude-work'), dir('Desktop')],
    [`${HOME}/.claude/skills`]: [dir('notebooklm')],
    [`${HOME}/.claude/skills/notebooklm`]: [file('SKILL.md')],
    [`${HOME}/.claude-work/skills`]: [dir('find-skills')],
    [`${HOME}/.claude-work/skills/find-skills`]: [file('SKILL.md')],
    [`${HOME}/.claude/plugins/cache`]: [dir('railway-skills')],
    [`${HOME}/.claude/plugins/cache/railway-skills`]: [dir('railway')],
    [`${HOME}/.claude/plugins/cache/railway-skills/railway`]: [dir('1.2.3')],
    [`${HOME}/.claude/plugins/cache/railway-skills/railway/1.2.3/skills`]: [dir('use-railway')],
    [`${HOME}/.claude-work/plugins/cache`]: [dir('claude-plugins-official')],
    [`${HOME}/.claude-work/plugins/cache/claude-plugins-official`]: [dir('claude-security')],
    [`${HOME}/.claude-work/plugins/cache/claude-plugins-official/claude-security`]: [dir('0.10.0')],
    [`${HOME}/.claude-work/plugins/cache/claude-plugins-official/claude-security/0.10.0/skills`]: [
      dir('claude-security')
    ],
    ['/Users/alwinpaul/Desktop/Project/Code UI/.claude/skills']: [dir('repo-skill')],
    ['/Users/alwinpaul/Desktop/Project/Code UI/.claude/skills/repo-skill']: [file('SKILL.md')]
  }
  /** `discover` answers skills.discover; by default the mobile gate refuses it. */
  function browsingClient(discover?: () => Promise<RpcResponse>) {
    const sendRequest = vi.fn(async (method: string, params?: unknown): Promise<RpcResponse> => {
      if (method === 'skills.discover' && discover) {
        return discover()
      }
      if (method === 'files.browseServerDir') {
        const path = (params as { path: string }).path
        const entries = listings[path]
        if (!entries) {
          return refused('not_found', `ENOENT ${path}`)
        }
        return { id: 'rpc', ok: true, result: { resolvedPath: path || HOME, entries }, _meta: { runtimeId: 'r' } }
      }
      return refused('forbidden', `Method '${method}' is not available to mobile clients`)
    })
    return { sendRequest }
  }

  type Latest = { nativeChatSkills: { name: string; sourceLabel: string }[]; loadNativeChatSkills: () => void }

  /** Mounts the menu for `chat` and returns handles to drive it: `show` puts
   *  another chat (or none) on the active tab. */
  function mount(client: ReturnType<typeof browsingClient>, chat: SkillsMenuChat | null, worktreeId = WORKTREE) {
    let latest: Latest | null = null
    function Probe({ chat }: { chat: SkillsMenuChat | null }): null {
      latest = useMobileNativeChatSkills({ client: client as never, worktreeId, chatIdentity: chat })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe, { chat }))
    })
    const settle = async (ms = 0) => {
      await act(async () => {
        if (ms > 0) {
          vi.advanceTimersByTime(ms)
        }
        for (let i = 0; i < 80; i += 1) {
          await Promise.resolve()
        }
      })
    }
    return {
      menu: () => latest!.nativeChatSkills.map((skill) => `${skill.sourceLabel}:${skill.name}`),
      names: () => latest!.nativeChatSkills.map((skill) => skill.name),
      load: () => latest!.loadNativeChatSkills(),
      show: (next: SkillsMenuChat | null) => act(() => renderer!.update(createElement(Probe, { chat: next }))),
      settle,
      calls: (method: string) => client.sendRequest.mock.calls.filter((call) => call[0] === method).length,
      listed: (path: string) =>
        client.sendRequest.mock.calls.filter(
          (call) => call[0] === 'files.browseServerDir' && (call[1] as { path: string }).path === path
        ).length
    }
  }

  async function menuFor(client: ReturnType<typeof browsingClient>, chat: SkillsMenuChat | null): Promise<string[]> {
    resetConfirmedSkillFilesForTest()
    const menu = mount(client, chat)
    menu.load()
    await menu.settle()
    return menu.menu()
  }

  it("offers a ~/.claude-work session its own skills and plugins, not ~/.claude's", async () => {
    expect(await menuFor(browsingClient(), claude(WORK_TRANSCRIPT))).toEqual([
      'Home skills:find-skills',
      'Repo skills:repo-skill',
      'Claude plugin claude-security:claude-security'
    ])
  })

  it('offers a ~/.claude session its own skills, not the ~/.claude-work ones', async () => {
    expect(await menuFor(browsingClient(), claude(HOME_TRANSCRIPT))).toEqual([
      'Home skills:notebooklm',
      'Repo skills:repo-skill',
      'Claude plugin railway:use-railway'
    ])
  })

  it('lists both profiles, as before, while the session has not said where it writes', async () => {
    expect(await menuFor(browsingClient(), claude(null))).toEqual([
      'Home skills:notebooklm',
      'Work skills:find-skills',
      'Repo skills:repo-skill',
      'Claude plugin railway:use-railway'
    ])
    act(() => renderer?.unmount())
    // Neither a Codex chat nor a shell tab names a Claude profile.
    expect(await menuFor(browsingClient(), { agent: 'codex', transcriptPath: CODEX_ROLLOUT })).toContain(
      'Home skills:notebooklm'
    )
    act(() => renderer?.unmount())
    expect(await menuFor(browsingClient(), null)).toContain('Home skills:notebooklm')
  })

  it("lists no home skills when the session's profile will not list, rather than another profile's", async () => {
    // The listing is refused, the way `files.browseServerDir` answers a
    // directory that is not on disk. The repo's own skills still come through.
    const gone = `${HOME}/.claude-gone/projects/-Users-alwinpaul-Desktop-Project-Code-UI/967668df-a7d9-40e7-964b-7812815c010d.jsonl`
    expect(await menuFor(browsingClient(), claude(gone))).toEqual(['Repo skills:repo-skill'])
  })

  it('walks again with the profile the session names once its transcript arrives', async () => {
    resetConfirmedSkillFilesForTest()
    const menu = mount(browsingClient(), claude(null))
    menu.load()
    await menu.settle()
    expect(menu.names()).toContain('notebooklm')
    menu.show(claude(WORK_TRANSCRIPT))
    menu.load()
    await menu.settle()
    expect(menu.names()).toEqual(['find-skills', 'repo-skill', 'claude-security'])
  })

  // One worktree can hold a tab per profile; the chat moves with the tab. A
  // walk is a few dozen listings over the relay.
  it('shows a tab its profile’s skills again after a tab switch without walking them twice', async () => {
    resetConfirmedSkillFilesForTest()
    const client = browsingClient()
    const menu = mount(client, claude(WORK_TRANSCRIPT), 'w-switch::/tmp/none')
    const open = async (chat: SkillsMenuChat) => {
      menu.show(chat)
      menu.load()
      await menu.settle()
      return menu.names()
    }
    expect(await open(claude(WORK_TRANSCRIPT))).toEqual(['find-skills', 'claude-security'])
    expect(await open(claude(HOME_TRANSCRIPT))).toEqual(['notebooklm', 'use-railway'])
    expect(await open(claude(WORK_TRANSCRIPT))).toEqual(['find-skills', 'claude-security'])
    expect(menu.listed(`${HOME}/.claude-work/plugins/cache`)).toBe(1)
    // The refused scan stays refused across the switch: asked once.
    expect(menu.calls('skills.discover')).toBe(1)
  })

  it('keeps a walk that finishes after the user left its tab out of the tab they are on', async () => {
    resetConfirmedSkillFilesForTest()
    const inner = browsingClient()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let heldOnce = false
    // The first listing of ~/.claude-work/plugins/cache, which only the
    // ~/.claude-work walk asks for, answers late.
    const sendRequest = vi.fn(async (method: string, params?: unknown): Promise<RpcResponse> => {
      if (
        !heldOnce &&
        method === 'files.browseServerDir' &&
        (params as { path: string }).path === `${HOME}/.claude-work/plugins/cache`
      ) {
        heldOnce = true
        await held
      }
      return inner.sendRequest(method, params)
    })
    // One object for the whole test: a new client is a reconnect.
    const menu = mount({ sendRequest }, claude(WORK_TRANSCRIPT), 'w-late::/tmp/none')
    menu.load()
    await menu.settle()
    menu.show(claude(HOME_TRANSCRIPT))
    menu.load()
    await menu.settle()
    expect(menu.names()).toEqual(['notebooklm', 'use-railway'])
    release()
    await menu.settle()
    expect(menu.names()).toEqual(['notebooklm', 'use-railway'])
    // And the late walk is what that tab shows when the user goes back.
    menu.show(claude(WORK_TRANSCRIPT))
    expect(menu.names()).toEqual(['find-skills', 'claude-security'])
  })

  // Found in review, 2026-09-25.
  describe('across tab and view changes', () => {
    const allowed = async (): Promise<RpcResponse> => ({
      id: 'rpc',
      ok: true,
      result: { skills: [] },
      _meta: { runtimeId: 'r' }
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not read the skills again while no Claude chat is on screen', async () => {
      resetConfirmedSkillFilesForTest()
      vi.useFakeTimers()
      const client = browsingClient()
      const menu = mount(client, claude(WORK_TRANSCRIPT), 'w-away::/Users/alwinpaul/Desktop/Project/Code UI')
      menu.load()
      await menu.settle()
      expect(menu.names()).toEqual(['find-skills', 'repo-skill', 'claude-security'])
      const listingsBefore = menu.calls('files.browseServerDir')
      // A shell tab, then a Codex chat: neither shows a Claude row.
      menu.show(null)
      await menu.settle(2_100)
      menu.show({ agent: 'codex', transcriptPath: CODEX_ROLLOUT })
      await menu.settle(2_100)
      expect(menu.calls('files.browseServerDir')).toBe(listingsBefore)
      menu.show(claude(WORK_TRANSCRIPT))
      expect(menu.names()).toEqual(['find-skills', 'repo-skill', 'claude-security'])
    })

    it('asks a host that answers the scan once, not again on every switch between two Claude tabs', async () => {
      vi.useFakeTimers()
      const menu = mount(browsingClient(allowed), claude(WORK_TRANSCRIPT), 'w-scan::/tmp/none')
      await menu.settle(2_100)
      expect(menu.calls('skills.discover')).toBe(1)
      for (let i = 0; i < 4; i += 1) {
        await menu.settle(5_000)
        menu.show(claude(i % 2 === 0 ? HOME_TRANSCRIPT : WORK_TRANSCRIPT))
        await menu.settle(2_100)
      }
      expect(menu.calls('skills.discover')).toBe(1)
    })

    it("does not show another profile's skills while a Claude chat's first read is under way", async () => {
      resetConfirmedSkillFilesForTest()
      // An earlier walk this launch left both profiles' list for the worktree.
      const first = mount(browsingClient(), claude(null), 'w-first::/tmp/none')
      first.load()
      await first.settle()
      expect(first.names()).toContain('notebooklm')
      act(() => renderer!.unmount())
      // The screen opens again with no chat resolved yet; the chat then names
      // its profile before the host has answered anything.
      const menu = mount(browsingClient(), null, 'w-first::/tmp/none')
      menu.show(claude(WORK_TRANSCRIPT))
      expect(menu.names()).not.toContain('notebooklm')
    })

    it("walks the chat's own profile when the host's refusal lands after the user switched to it", async () => {
      resetConfirmedSkillFilesForTest()
      vi.useFakeTimers()
      let refuse: () => void = () => {}
      const client = browsingClient(
        () =>
          new Promise<RpcResponse>((resolve) => {
            refuse = () => resolve(refused('forbidden', "Method 'skills.discover' is not available to mobile clients"))
          })
      )
      const menu = mount(client, claude(null), 'w-slow::/tmp/none')
      menu.load()
      await menu.settle()
      menu.show(claude(WORK_TRANSCRIPT))
      // The chat's own two-second read finds the scan still out.
      await menu.settle(2_100)
      refuse()
      await menu.settle()
      expect(menu.listed(`${HOME}/.claude-work/plugins/cache`)).toBe(1)
      expect(menu.names()).toEqual(['find-skills', 'claude-security'])
    })

    it('reads a newly named profile over the new connection when the relay reconnects right after the switch', async () => {
      resetConfirmedSkillFilesForTest()
      vi.useFakeTimers()
      // The first connection dies with the reconnect: it answers nothing after.
      let firstDead = false
      const firstAlive = browsingClient()
      const first = {
        sendRequest: vi.fn(async (method: string, params?: unknown): Promise<RpcResponse> =>
          firstDead ? refused('not_connected', 'closed') : firstAlive.sendRequest(method, params)
        )
      }
      const second = browsingClient()
      let latest: Latest | null = null
      function Probe({ client, chat }: { client: typeof first; chat: SkillsMenuChat }): null {
        latest = useMobileNativeChatSkills({ client: client as never, worktreeId: 'w-relay::/tmp/none', chatIdentity: chat })
        return null
      }
      const settle = async (ms = 0) => {
        await act(async () => {
          vi.advanceTimersByTime(ms)
          for (let i = 0; i < 80; i += 1) {
            await Promise.resolve()
          }
        })
      }
      act(() => {
        renderer = create(createElement(Probe, { client: first, chat: claude(HOME_TRANSCRIPT) }))
      })
      latest!.loadNativeChatSkills()
      await settle()
      expect(latest!.nativeChatSkills.map((skill) => skill.name)).toEqual(['notebooklm', 'use-railway'])
      act(() => renderer!.update(createElement(Probe, { client: first, chat: claude(WORK_TRANSCRIPT) })))
      await settle(1_000)
      firstDead = true
      act(() => renderer!.update(createElement(Probe, { client: second, chat: claude(WORK_TRANSCRIPT) })))
      await settle(1_100)
      await settle(1_000)
      const secondListed = second.sendRequest.mock.calls.filter(
        (call) => call[0] === 'files.browseServerDir' && (call[1] as { path: string }).path === `${HOME}/.claude-work/plugins/cache`
      )
      expect(secondListed).toHaveLength(1)
      expect(latest!.nativeChatSkills.map((skill) => skill.name)).toEqual(['find-skills', 'claude-security'])
    })
  })
})
