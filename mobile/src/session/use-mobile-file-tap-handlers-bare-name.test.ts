import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileFileTapHandlers } from './use-mobile-file-tap-handlers'

const push = vi.fn()

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn() }))

// The symptom (2026-09-25, reported with a screenshot): an agent's reply cited the code span
// `mobile-native-chat-codex-command.ts`, a bare name, drawn as a link. The file sits at
// mobile/src/session/ in that worktree, but chat paths resolve against the worktree root, so the tap
// said only "Couldn't open mobile-native-chat-codex-command.ts" — no reason, and no way to reach it.

type Reply =
  | { ok: true; result: unknown; _meta: { runtimeId: string } }
  | { ok: false; error: { code: string; message: string }; _meta: { runtimeId: string } }

function ok(result: unknown): Reply {
  return { ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function refused(code: string, message: string): Reply {
  return { ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

const SEARCH_LIMIT = 32

/**
 * Orca's own ranking for `files.searchPaths` (src/main/runtime/runtime-mobile-file-path-search.ts,
 * rankRuntimeMobileFilePaths, read at orca ac675ded6e): the sorted inventory, prefix matches on
 * the path or its base name first, then substring matches, each bucket capped at the limit.
 * `truncated` is the host's `inventory.truncated || totalCount > limit`.
 */
function hostSearch(paths: readonly string[], query: string, limit: number, truncated: boolean) {
  const normalized = query.trim().toLowerCase()
  const prefix: string[] = []
  const substring: string[] = []
  let totalCount = 0
  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const lower = path.toLowerCase()
    const basename = lower.split('/').pop() ?? lower
    if (lower.startsWith(normalized) || basename.startsWith(normalized)) {
      totalCount++
      if (prefix.length < limit) {
        prefix.push(path)
      }
    } else if (lower.includes(normalized)) {
      totalCount++
      if (substring.length < limit) {
        substring.push(path)
      }
    }
  }
  return {
    worktree: 'wt-1',
    rootPath: '/repo',
    files: [...prefix, ...substring].slice(0, limit).map(fileRow),
    totalCount,
    truncated: truncated || totalCount > limit
  }
}

function fileRow(relativePath: string) {
  return { relativePath, basename: relativePath.split('/').pop(), kind: 'text' }
}

/** The first `cap` paths in the host's sorted order, and whether any were left out. */
function capped(paths: readonly string[], cap: number): { paths: string[]; truncated: boolean } {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b))
  return { paths: sorted.slice(0, cap), truncated: sorted.length > cap }
}

type DesktopScript = {
  files: readonly string[]
  /** Replaces the desktop's own `files.searchPaths` answer; a throw is a rejected request. */
  search?: () => Reply | Promise<Reply>
  /** Replaces the desktop's own `files.list` answer. */
  list?: () => Reply | Promise<Reply>
  resolve?: (pathText: string) => Reply | undefined
  open?: (relativePath: string) => Reply | undefined
  /**
   * The inventory the search ranks over, as the host last cached it (for 30 s,
   * MOBILE_FILE_PATH_SEARCH_CACHE_TTL_MS). Defaults to `files`; set it to what the disk held
   * before an agent wrote a new file.
   */
  searchInventory?: readonly string[]
  /** The search inventory's cap, MOBILE_FILE_PATH_SEARCH_CACHE_LIMIT (20,000) on the host. */
  searchCap?: number
  /** `files.list`'s cap, MOBILE_FILE_LIST_LIMIT (5,000) on the host. It is not cached. */
  listCap?: number
  connection?: ConnectionState
}

/** A desktop holding `files`, answering the four methods a chat tap can send. */
function fakeDesktop(script: DesktopScript) {
  const directories = new Set(
    script.files.flatMap((path) =>
      path
        .split('/')
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
    )
  )
  const sent: string[] = []
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    const args = (params ?? {}) as Record<string, unknown>
    sent.push(method === 'files.searchPaths' ? `${method} ${String(args.query)}` : method)
    switch (method) {
      case 'files.resolveTerminalPath': {
        const pathText = String(args.pathText)
        const scripted = script.resolve?.(pathText)
        if (scripted) {
          return scripted
        }
        const location = {
          worktree: 'wt-1',
          relativePath: pathText,
          absolutePath: `/repo/${pathText}`
        }
        if (directories.has(pathText)) {
          return ok({ ...location, exists: true, isDirectory: true })
        }
        if (!script.files.includes(pathText)) {
          return ok({ ...location, exists: false, isDirectory: false })
        }
        return ok({
          ...location,
          exists: true,
          isDirectory: false,
          openTarget: { kind: 'worktree-file', provider: 'local', ...location }
        })
      }
      case 'files.searchPaths': {
        if (script.search) {
          return script.search()
        }
        const inventory = capped(script.searchInventory ?? script.files, script.searchCap ?? 20_000)
        return ok(
          hostSearch(inventory.paths, String(args.query), Number(args.limit), inventory.truncated)
        )
      }
      case 'files.list': {
        if (script.list) {
          return script.list()
        }
        const listed = capped(script.files, script.listCap ?? 5_000)
        return ok({
          worktree: 'wt-1',
          rootPath: '/repo',
          files: listed.paths.map(fileRow),
          totalCount: script.files.length,
          truncated: listed.truncated
        })
      }
      case 'files.open': {
        const relativePath = String(args.relativePath)
        return (
          script.open?.(relativePath) ??
          ok({ worktree: 'wt-1', relativePath, kind: 'text', opened: true })
        )
      }
      default:
        throw new Error(`the fake desktop has no ${method}`)
    }
  })
  const client = {
    sendRequest,
    getState: () => script.connection ?? 'connected'
  } as unknown as RpcClient
  return { client, sendRequest, sent }
}

/** Both chat surfaces a tap comes from, gated differently by the open flow. */
const CHATS = [
  {
    label: 'a terminal-backed chat (Claude Code or Codex in a terminal tab)',
    activeHandle: 'terminal-1' as string | null,
    tabId: 'terminal-tab',
    tabType: 'terminal'
  },
  {
    label: 'a structured agent-session chat',
    activeHandle: null as string | null,
    tabId: 'agent-tab-1',
    tabType: 'agent-session'
  }
] as const

type Chat = (typeof CHATS)[number]
type Handlers = ReturnType<typeof useMobileFileTapHandlers>

let renderer: ReactTestRenderer | null = null
let handlers: Handlers | null = null

function Harness({ options }: { options: Parameters<typeof useMobileFileTapHandlers>[0] }): null {
  handlers = useMobileFileTapHandlers(options)
  return null
}

function mount(desktop: ReturnType<typeof fakeDesktop>, chat: Chat = CHATS[0]) {
  const openedTabs = new Map<string, { id: string; relativePath: string }>()
  const live = { tabId: chat.tabId as string, handle: chat.activeHandle }
  const options = {
    client: desktop.client,
    hostId: 'host-1',
    worktreeId: 'wt-1',
    worktreeName: 'code-ui',
    nativeChatSessionId: 'session-1',
    activeHandleRef: { current: chat.activeHandle },
    terminalCwdRef: { current: new Map<string, string>() },
    openBrowser: vi.fn(),
    fetchSessionTabs: vi.fn(async () => {
      for (const call of desktop.sendRequest.mock.calls) {
        const [method, params] = call as unknown as [string, { relativePath?: string }]
        if (method === 'files.open' && params.relativePath) {
          openedTabs.set(params.relativePath, {
            id: `file-tab:${params.relativePath}`,
            relativePath: params.relativePath
          })
        }
      }
    }),
    getSessionTabs: () => [...openedTabs.values()],
    getActiveSessionTabId: () => live.tabId,
    getActiveSessionTabType: () => chat.tabType as string | null,
    switchSessionTab: vi.fn(),
    scheduleDelayedAction: vi.fn((callback: () => void) => callback()),
    reportChatTapFailure: vi.fn()
  }
  act(() => {
    renderer = create(createElement(Harness, { options }))
  })
  /** The user moves to another tab while the tap is in flight. */
  const leaveChat = () => {
    live.tabId = 'another-tab'
    options.activeHandleRef.current = chat.activeHandle ? 'terminal-2' : null
  }
  return { options, leaveChat }
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 20; turn++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

function tap(pathText: string): void {
  act(() => handlers!.handleNativeChatFileTap(pathText))
}

function openedPaths(desktop: ReturnType<typeof fakeDesktop>): string[] {
  return desktop.sendRequest.mock.calls.flatMap((call) => {
    const [method, params] = call as unknown as [string, { relativePath?: string }]
    return method === 'files.open' && params.relativePath ? [params.relativePath] : []
  })
}

beforeEach(() => {
  push.mockClear()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  handlers = null
})

const REPORTED = 'mobile-native-chat-codex-command.ts'
const REPORTED_PATH = `mobile/src/session/${REPORTED}`

describe.each(CHATS)('a bare file name tapped in $label', (chat) => {
  it('opens a file at the worktree root exactly as before, with no search', async () => {
    const desktop = fakeDesktop({ files: ['README.md', 'mobile/README.md'] })
    const { options } = mount(desktop, chat)

    tap('README.md')
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath', 'files.open'])
    expect(openedPaths(desktop)).toEqual(['README.md'])
    expect(options.switchSessionTab).toHaveBeenCalledWith({
      id: 'file-tab:README.md',
      relativePath: 'README.md'
    })
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
  })

  it('opens the one file of that name in a subfolder (the reported code span)', async () => {
    const desktop = fakeDesktop({
      files: [
        REPORTED_PATH,
        'mobile/src/session/mobile-native-chat-codex-command.test.ts',
        'mobile/src/session/mobile-native-chat-codex-commands.ts'
      ]
    })
    const { options } = mount(desktop, chat)

    tap(REPORTED)
    await settle()

    expect(desktop.sent).toEqual([
      'files.resolveTerminalPath',
      `files.searchPaths ${REPORTED}`,
      'files.resolveTerminalPath',
      'files.open'
    ])
    expect(openedPaths(desktop)).toEqual([REPORTED_PATH])
    expect(options.switchSessionTab).toHaveBeenCalledWith({
      id: `file-tab:${REPORTED_PATH}`,
      relativePath: REPORTED_PATH
    })
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
  })

  it('keeps the :line:col the agent cited on the file it finds', async () => {
    const desktop = fakeDesktop({ files: [REPORTED_PATH] })
    mount(desktop, chat)

    tap(`${REPORTED}:120:7`)
    await settle()

    expect(desktop.sendRequest).toHaveBeenCalledWith(
      'files.searchPaths',
      { worktree: 'id:wt-1', query: REPORTED, limit: SEARCH_LIMIT },
      { timeoutMs: 15_000 }
    )
    expect(push).toHaveBeenCalledWith({
      pathname: '/h/[hostId]/files/preview/[worktreeId]',
      params: expect.objectContaining({
        source: 'worktree',
        relativePath: REPORTED_PATH,
        line: '120',
        column: '7'
      })
    })
  })

  it('offers every folder that holds the name, and opens only the one picked', async () => {
    const desktop = fakeDesktop({
      files: ['mobile/src/a/index.ts', 'mobile/src/b/index.ts', 'mobile/src/b/index.tsx']
    })
    const { options } = mount(desktop, chat)

    tap('index.ts')
    await settle()

    const picker = handlers!.fileTapMatchPicker
    expect(picker.visible).toBe(true)
    expect(picker.offer).toMatchObject({
      name: 'index.ts',
      paths: ['mobile/src/a/index.ts', 'mobile/src/b/index.ts'],
      complete: true
    })
    expect(openedPaths(desktop)).toEqual([])
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()

    // The drawer's row press, then its close, then the hide it animates.
    act(() => {
      handlers!.fileTapMatchPicker.pick('mobile/src/b/index.ts')
      handlers!.fileTapMatchPicker.close()
    })
    expect(handlers!.fileTapMatchPicker.visible).toBe(false)
    expect(openedPaths(desktop)).toEqual([])
    act(() => handlers!.fileTapMatchPicker.afterClose())
    await settle()

    expect(openedPaths(desktop)).toEqual(['mobile/src/b/index.ts'])
    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
  })

  it('says no file of that name is in the workspace when none is', async () => {
    const desktop = fakeDesktop({ files: ['src/other.ts', 'src/x.tsx'] })
    const { options } = mount(desktop, chat)

    tap('x.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open x.ts: no file named x.ts in code-ui"
    )
    expect(openedPaths(desktop)).toEqual([])
    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
  })
})

describe('a bare file name the desktop cannot search normally', () => {
  it('falls back to the file inventory on a desktop without path search', async () => {
    const desktop = fakeDesktop({
      files: [REPORTED_PATH, 'mobile/src/session/other.ts'],
      search: () => refused('method_not_found', 'Unknown method: files.searchPaths')
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(desktop.sent).toEqual([
      'files.resolveTerminalPath',
      `files.searchPaths ${REPORTED}`,
      'files.list',
      'files.resolveTerminalPath',
      'files.open'
    ])
    expect(openedPaths(desktop)).toEqual([REPORTED_PATH])
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
  })

  it('says no such name after the inventory fallback finds none', async () => {
    const desktop = fakeDesktop({
      files: ['mobile/src/session/other.ts'],
      search: () => refused('method_not_found', 'Unknown method: files.searchPaths')
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: no file named ${REPORTED} in code-ui`
    )
  })

  it('says the desktop did not answer when the inventory fallback is rejected too', async () => {
    const desktop = fakeDesktop({
      files: [REPORTED_PATH],
      search: () => refused('method_not_found', 'Unknown method: files.searchPaths'),
      list: () => {
        throw new Error('Request timed out: files.list')
      }
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: your desktop did not answer`
    )
    expect(openedPaths(desktop)).toEqual([])
  })

  it('says the desktop did not answer when the search is rejected, and asks nothing more', async () => {
    const desktop = fakeDesktop({
      files: [REPORTED_PATH],
      search: () => {
        throw new Error('Request timed out: files.searchPaths')
      }
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath', `files.searchPaths ${REPORTED}`])
    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: your desktop did not answer`
    )
  })

  it('names a malformed search reply instead of calling the file missing', async () => {
    const desktop = fakeDesktop({ files: [REPORTED_PATH], search: () => ok('not a file list') })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: the desktop's reply could not be read`
    )
    expect(openedPaths(desktop)).toEqual([])
  })

  it('relays a search refusal the inventory cannot get past either', async () => {
    const desktop = fakeDesktop({
      files: [REPORTED_PATH],
      search: () => refused('selector_not_found', 'No such workspace'),
      list: () => refused('selector_not_found', 'No such workspace')
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: the desktop refused it (No such workspace)`
    )
  })
})

describe('how many files carry the tapped name', () => {
  it('says so when neither the search nor the uncached inventory holds the name', async () => {
    const desktop = fakeDesktop({ files: [] })
    const { options } = mount(desktop)

    tap('x.ts')
    await settle()

    expect(desktop.sent).toEqual([
      'files.resolveTerminalPath',
      'files.searchPaths x.ts',
      'files.list'
    ])
    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open x.ts: no file named x.ts in code-ui"
    )
  })

  it('finds a file the agent wrote after the desktop last cached its search', async () => {
    // The search ranks over an inventory the host keeps for 30 s; an agent that writes
    // `new/helper.ts` and cites it at once is cited before that inventory has it.
    const desktop = fakeDesktop({
      files: ['old/other.ts', 'new/helper.ts'],
      searchInventory: ['old/other.ts']
    })
    const { options } = mount(desktop)

    tap('helper.ts')
    await settle()

    expect(openedPaths(desktop)).toEqual(['new/helper.ts'])
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
  })

  it('does not let a stale search vouch for the part of the workspace the capped list skipped', async () => {
    // The cached search saw nothing; the fresh list stops before `zeta/new.ts`. Whether the file
    // exists past the list is unknown, and the line has to say so.
    const desktop = fakeDesktop({
      files: ['a.ts', 'b.ts', 'zeta/new.ts'],
      searchInventory: [],
      listCap: 2
    })
    const { options } = mount(desktop)

    tap('new.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open new.ts: no file named new.ts in code-ui (the desktop searched only part of it)"
    )
  })

  it('keeps what a cut search found when the capped inventory stops short of it', async () => {
    // The shape of a main checkout with agent worktrees nested under .claude/worktrees: they sort
    // first, so the 5,000-file list can end before the real file the 20,000-file search still saw.
    const nested = '.claude/worktrees/agent-a/mobile/src/session/target.ts'
    const real = 'mobile/src/session/target.ts'
    const desktop = fakeDesktop({
      files: [nested, 'filler-1.ts', 'filler-2.ts', real, 'zz.ts'],
      searchCap: 4,
      listCap: 2
    })
    mount(desktop)

    tap('target.ts')
    await settle()

    expect(handlers!.fileTapMatchPicker.offer).toMatchObject({
      paths: [nested, real],
      complete: false
    })
  })

  it('opens the single exact match among many that only start with the name', async () => {
    const desktop = fakeDesktop({
      files: ['a/x.ts.snap', 'b/x.tsx', 'c/x.ts', 'd/x.ts.map', 'e/prefix-x.ts']
    })
    mount(desktop)

    tap('x.ts')
    await settle()

    expect(openedPaths(desktop)).toEqual(['c/x.ts'])
  })

  it('does not trust a single match from a search that hit its cap', async () => {
    // Forty `index.tsx` files sort ahead of the second `index.ts`, so the capped search sees one
    // exact match; opening it would be a guess. The inventory is the complete list.
    const crowd = Array.from({ length: 40 }, (_, i) => `a${String(i).padStart(2, '0')}/index.tsx`)
    const desktop = fakeDesktop({ files: [...crowd, 'a05/index.ts', 'z/index.ts'] })
    mount(desktop)

    tap('index.ts')
    await settle()

    expect(desktop.sent).toEqual([
      'files.resolveTerminalPath',
      'files.searchPaths index.ts',
      'files.list'
    ])
    expect(handlers!.fileTapMatchPicker.offer).toMatchObject({
      paths: ['a05/index.ts', 'z/index.ts'],
      complete: true
    })
    expect(openedPaths(desktop)).toEqual([])
  })

  // Reported 2026-09-26 (phone recording): a tapped `black_text_changes_bridge.md`
  // brought up a sheet with one row to tap before the file opened. One match
  // opens; a sheet is for a choice.
  it('opens a lone match at once even when the desktop searched only part of the workspace', async () => {
    const desktop = fakeDesktop({
      files: ['deep/x.ts', 'z-1.ts', 'z-2.ts'],
      searchCap: 2,
      listCap: 2
    })
    mount(desktop)

    tap('x.ts')
    await settle()

    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
    expect(openedPaths(desktop)).toEqual(['deep/x.ts'])
  })

  it('says the search was partial when a truncated inventory holds no such name', async () => {
    const desktop = fakeDesktop({
      files: ['deep/y.ts', 'z-1.ts', 'z-2.ts'],
      searchCap: 2,
      listCap: 2
    })
    const { options } = mount(desktop)

    tap('x.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open x.ts: no file named x.ts in code-ui (the desktop searched only part of it)"
    )
  })
})

describe('every other failed chat tap says why', () => {
  it('does not search a path that names a folder, and says it is not there', async () => {
    const desktop = fakeDesktop({ files: ['gone/other.ts'] })
    const { options } = mount(desktop)

    tap('gone/missing.ts')
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath'])
    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open gone/missing.ts: no such file in code-ui"
    )
  })

  it('says a folder is a folder', async () => {
    const desktop = fakeDesktop({ files: ['mobile/src/app.ts'] })
    const { options } = mount(desktop)

    tap('mobile/src')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open mobile/src: it is a folder"
    )
  })

  it('says a path outside the workspace is outside it', async () => {
    const desktop = fakeDesktop({
      files: [],
      resolve: (pathText) =>
        ok({
          worktree: 'wt-1',
          relativePath: null,
          absolutePath: pathText,
          exists: false,
          isDirectory: false
        })
    })
    const { options } = mount(desktop)

    tap('/etc/hosts.conf')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open /etc/hosts.conf: it is outside code-ui"
    )
  })

  it('does not call a ~ path the desktop cannot place missing', async () => {
    // On an SSH workspace the host cannot expand ~ and answers without looking
    // (orca-runtime-files.ts resolveTerminalPath, the `empty` reply): no path of either kind.
    const desktop = fakeDesktop({
      files: [],
      resolve: () =>
        ok({
          worktree: 'wt-1',
          relativePath: null,
          absolutePath: null,
          exists: false,
          isDirectory: false
        })
    })
    const { options } = mount(desktop)

    tap('~/notes/plan.md')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open ~/notes/plan.md: the desktop can't reach that path from code-ui"
    )
  })

  it('does not name this workspace for a miss in the sibling workspace a path points into', async () => {
    const desktop = fakeDesktop({
      files: [],
      resolve: () =>
        ok({
          worktree: 'wt-2',
          relativePath: 'src/gone.ts',
          absolutePath: '/Users/ada/other/src/gone.ts',
          exists: false,
          isDirectory: false
        })
    })
    const { options } = mount(desktop)

    tap('/Users/ada/other/src/gone.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open /Users/ada/other/src/gone.ts: no such file in the workspace it points into"
    )
  })

  it("relays the desktop's refusal of the lookup, without searching", async () => {
    const desktop = fakeDesktop({
      files: [REPORTED_PATH],
      resolve: () => refused('selector_not_found', 'No such workspace')
    })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath'])
    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: the desktop refused it (No such workspace)`
    )
  })

  it('says the desktop did not answer a lookup that timed out while connected', async () => {
    const desktop = fakeDesktop({
      files: [],
      resolve: () => {
        throw new Error('Request timed out: files.resolveTerminalPath')
      }
    })
    const { options } = mount(desktop)

    tap('src/app.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open src/app.ts: your desktop did not answer"
    )
  })

  it('names a malformed lookup reply instead of calling the file missing', async () => {
    const desktop = fakeDesktop({ files: [], resolve: () => ok('not a resolution') })
    const { options } = mount(desktop)

    tap(REPORTED)
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath'])
    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      `Couldn't open ${REPORTED}: the desktop's reply could not be read`
    )
  })

  it("names a fault on the phone as the phone's, not the desktop's", async () => {
    const desktop = fakeDesktop({ files: ['src/app.ts'] })
    const { options } = mount(desktop)
    push.mockImplementationOnce(() => {
      throw new Error('Navigation is not ready')
    })

    tap('src/app.ts:3')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open src/app.ts:3: Navigation is not ready"
    )
  })

  it('says the phone is not connected when the link is down', async () => {
    const desktop = fakeDesktop({
      files: [],
      connection: 'reconnecting',
      resolve: () => {
        throw new Error('Timed out while connecting to the remote Orca runtime.')
      }
    })
    const { options } = mount(desktop)

    tap('src/app.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open src/app.ts: not connected to your desktop"
    )
  })

  it('says a binary file does not open on the phone', async () => {
    const desktop = fakeDesktop({
      files: ['assets/logo.psd'],
      open: (relativePath) => ok({ worktree: 'wt-1', relativePath, kind: 'binary', opened: false })
    })
    const { options } = mount(desktop)

    tap('assets/logo.psd')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open assets/logo.psd: binary files don't open on the phone"
    )
  })

  it("relays the desktop's refusal of the open", async () => {
    const desktop = fakeDesktop({
      files: ['src/app.ts'],
      open: () => refused('runtime_error', 'File is locked')
    })
    const { options } = mount(desktop)

    tap('src/app.ts')
    await settle()

    expect(options.reportChatTapFailure).toHaveBeenCalledWith(
      "Couldn't open src/app.ts: the desktop refused it (File is locked)"
    )
  })
})

describe('a bare name tapped in the terminal itself', () => {
  it('is resolved against the terminal cwd alone: no search, and still no line', async () => {
    const desktop = fakeDesktop({ files: [REPORTED_PATH] })
    const { options } = mount(desktop)
    options.terminalCwdRef.current.set('terminal-1', '/repo/mobile')

    act(() => handlers!.handleFileTap('terminal-1', REPORTED, null, null))
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath'])
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
  })
})

describe('a tap the user has walked away from', () => {
  it('reports nothing and offers nothing once the user leaves the chat mid-search', async () => {
    let answerSearch: (reply: Reply) => void = () => {}
    const desktop = fakeDesktop({
      files: ['a/index.ts', 'b/index.ts'],
      search: () => new Promise<Reply>((resolve) => (answerSearch = resolve))
    })
    const { options, leaveChat } = mount(desktop)

    tap('index.ts')
    await settle()
    leaveChat()
    answerSearch(ok(hostSearch(['a/index.ts', 'b/index.ts'], 'index.ts', SEARCH_LIMIT, false)))
    await settle()

    expect(handlers!.fileTapMatchPicker.offer).toBeNull()
    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
    expect(openedPaths(desktop)).toEqual([])
  })

  it('asks the desktop for no inventory once the user has left the chat mid-search', async () => {
    // A cut search would go on to `files.list`, a full scan of the workspace on the desktop.
    let answerSearch: (reply: Reply) => void = () => {}
    const desktop = fakeDesktop({
      files: ['a/x.ts'],
      search: () => new Promise<Reply>((resolve) => (answerSearch = resolve))
    })
    const { leaveChat } = mount(desktop)

    tap('x.ts')
    await settle()
    leaveChat()
    answerSearch(ok({ files: [fileRow('a/x.ts')], truncated: true }))
    await settle()

    expect(desktop.sent).toEqual(['files.resolveTerminalPath', 'files.searchPaths x.ts'])
  })

  it('says nothing about a missing name once the user leaves the chat mid-search', async () => {
    let answerSearch: (reply: Reply) => void = () => {}
    const desktop = fakeDesktop({
      files: [],
      search: () => new Promise<Reply>((resolve) => (answerSearch = resolve))
    })
    const { options, leaveChat } = mount(desktop)

    tap('x.ts')
    await settle()
    leaveChat()
    answerSearch(ok(hostSearch([], 'x.ts', SEARCH_LIMIT, false)))
    await settle()

    expect(options.reportChatTapFailure).not.toHaveBeenCalled()
  })
})
