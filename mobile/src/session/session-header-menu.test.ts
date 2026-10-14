import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileSessionTab } from './mobile-session-route-types'
import {
  archivableSessionTab,
  renameSessionWorkspace,
  sessionConnectionLine,
  sessionHeaderMenuActions,
  sessionHeaderMenuEntries
} from './session-header-menu'

// The header menu's session entries (parity gap G35) and what each does.

describe('which session entries the header menu offers', () => {
  const all = {
    branch: 'feature/header',
    runningTasks: 2,
    canOpenTasks: true,
    canChangeModel: true,
    canRename: true,
    canArchive: true,
    sessionId: 'a1b2c3d4-0000-4000-8000-000000000000'
  }

  // The app builds its list in `us8` ~L318-357: Copy branch, Background tasks, Share, Rename,
  // the project entries, Archive, and its Debug group (with Copy session ID) last. Change model
  // takes the slot Share holds there (Orca has no share path), the one the user asked for.
  it("offers all six, in the Claude app's order, when the session has each", () => {
    expect(sessionHeaderMenuEntries(all)).toEqual([
      'copy-branch',
      'background-tasks',
      'change-model',
      'rename',
      'archive',
      'copy-session-id'
    ])
  })

  it('offers Change model only where a model sheet can open (the chat is showing and has a model)', () => {
    expect(sessionHeaderMenuEntries({ ...all, canChangeModel: false })).not.toContain('change-model')
  })

  it('offers Archive only for a tab that is an agent session', () => {
    expect(sessionHeaderMenuEntries({ ...all, canArchive: false })).not.toContain('archive')
  })

  it('offers Copy branch only with a branch (none on a detached HEAD or a folder)', () => {
    expect(sessionHeaderMenuEntries({ ...all, branch: null })).not.toContain('copy-branch')
  })

  it('offers Background tasks only while tasks run and the chat can open its sheet', () => {
    expect(sessionHeaderMenuEntries({ ...all, runningTasks: 0 })).not.toContain('background-tasks')
    expect(sessionHeaderMenuEntries({ ...all, canOpenTasks: false })).not.toContain('background-tasks')
    expect(sessionHeaderMenuEntries({ ...all, runningTasks: 1 })).toContain('background-tasks')
  })

  it('offers Copy session ID only when the agent named its session', () => {
    expect(sessionHeaderMenuEntries({ ...all, sessionId: null })).not.toContain('copy-session-id')
    expect(sessionHeaderMenuEntries({ ...all, sessionId: '  ' })).not.toContain('copy-session-id')
  })

  it('offers nothing when the session has none of them', () => {
    expect(
      sessionHeaderMenuEntries({
        branch: null,
        runningTasks: 0,
        canOpenTasks: false,
        canChangeModel: false,
        canRename: false,
        canArchive: false,
        sessionId: null
      })
    ).toEqual([])
  })
})

describe('renaming the session writes the workspace display name through worktree.set', () => {
  const ok = { id: 'set', ok: true, result: { worktree: {} }, _meta: { runtimeId: 'r' } }
  const client = (reply: unknown) => ({ sendRequest: vi.fn().mockImplementation(async () => reply) }) as unknown as RpcClient & { sendRequest: ReturnType<typeof vi.fn> }

  it("sends the trimmed name for this workspace and reports the host's acceptance", async () => {
    const host = client(ok)
    await expect(renameSessionWorkspace(host, 'repo-1::/work/a', '  Header parity  ')).resolves.toBe('renamed')
    const [method, params] = host.sendRequest.mock.calls[0]!
    expect(method).toBe('worktree.set')
    expect(params).toEqual({ worktree: 'id:repo-1::/work/a', displayName: 'Header parity' })
  })

  it('reports a refusal', async () => {
    const host = client({ id: 'set', ok: false, error: { code: 'selector_not_found', message: 'gone' }, _meta: { runtimeId: 'r' } })
    await expect(renameSessionWorkspace(host, 'repo-1::/work/a', 'x')).resolves.toBe('refused')
  })

  it('reports a failed send', async () => {
    const host = { sendRequest: vi.fn().mockRejectedValue(new Error('socket closed')) } as unknown as RpcClient
    await expect(renameSessionWorkspace(host, 'repo-1::/work/a', 'x')).resolves.toBe('failed')
  })

  it('sends nothing for an empty name, which Orca would read as "fall back to the branch"', async () => {
    const host = client(ok)
    await expect(renameSessionWorkspace(host, 'repo-1::/work/a', '   ')).resolves.toBe('refused')
    expect(host.sendRequest).not.toHaveBeenCalled()
  })
})

describe('the menu actions say what happened', () => {
  function deps(overrides: { write?: () => Promise<void>; client?: RpcClient | null } = {}) {
    return {
      client: overrides.client === undefined ? ({ sendRequest: vi.fn().mockResolvedValue({ id: 's', ok: true, result: {}, _meta: { runtimeId: 'r' } }) } as unknown as RpcClient) : overrides.client,
      worktreeId: 'repo-1::/work/a',
      branch: 'feature/header',
      sessionId: 'a1b2c3d4-0000-4000-8000-000000000000',
      clipboard: { writeText: vi.fn(overrides.write ?? (async () => {})) },
      showToast: vi.fn()
    }
  }

  it('copies the branch name and says so, as the Claude app does', async () => {
    const d = deps()
    await sessionHeaderMenuActions(d).copyBranch()
    expect(d.clipboard.writeText).toHaveBeenCalledWith('feature/header')
    expect(d.showToast).toHaveBeenCalledWith('Branch name copied')
  })

  it('copies the session ID and says so', async () => {
    const d = deps()
    await sessionHeaderMenuActions(d).copySessionId()
    expect(d.clipboard.writeText).toHaveBeenCalledWith('a1b2c3d4-0000-4000-8000-000000000000')
    expect(d.showToast).toHaveBeenCalledWith('Session ID copied')
  })

  it('says a copy failed rather than claiming it landed', async () => {
    const d = deps({
      write: async () => {
        throw new Error('the clipboard did not accept this text')
      }
    })
    await sessionHeaderMenuActions(d).copyBranch()
    await sessionHeaderMenuActions(d).copySessionId()
    expect(d.showToast.mock.calls.map((call) => call[0])).toEqual(["Couldn't copy branch name", "Couldn't copy session ID"])
  })

  it('says a rename the host refused, or could not be sent, did not happen', async () => {
    const refused = deps({ client: { sendRequest: vi.fn().mockResolvedValue({ id: 's', ok: false, error: { code: 'x', message: 'no' }, _meta: { runtimeId: 'r' } }) } as unknown as RpcClient })
    await sessionHeaderMenuActions(refused).renameSession('New')
    expect(refused.showToast.mock.calls.at(-1)?.[0]).toBe("Couldn't rename the session")
    const offline = deps({ client: null })
    await sessionHeaderMenuActions(offline).renameSession('New')
    expect(offline.showToast.mock.calls.at(-1)?.[0]).toBe("Couldn't rename the session")
  })

  it('says nothing extra after a rename the host took: the title itself changes', async () => {
    const d = deps()
    await sessionHeaderMenuActions(d).renameSession('New')
    expect(d.showToast).not.toHaveBeenCalled()
  })
})

describe('which tab Archive closes', () => {
  const terminal = (over: Partial<Extract<MobileSessionTab, { type: 'terminal' }>> = {}): MobileSessionTab => ({
    type: 'terminal',
    id: 't1',
    title: 'claude',
    terminal: 'h1',
    isActive: true,
    launchAgent: 'claude',
    ...over
  })
  const browser: MobileSessionTab = {
    type: 'browser',
    id: 'b1',
    title: 'Docs',
    browserWorkspaceId: 'w1',
    browserPageId: 'p1',
    url: 'https://x.test',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    isActive: false
  }

  it('is the active tab when an agent runs in it', () => {
    expect(archivableSessionTab([terminal(), browser], 't1')?.id).toBe('t1')
  })

  it('is no tab for a plain shell, a browser, or no active tab (one tab, none, or a stale id)', () => {
    expect(archivableSessionTab([terminal({ launchAgent: undefined, title: 'zsh' })], 't1')).toBeNull()
    expect(archivableSessionTab([terminal(), browser], 'b1')).toBeNull()
    expect(archivableSessionTab([], 't1')).toBeNull()
    expect(archivableSessionTab([terminal()], null)).toBeNull()
    expect(archivableSessionTab([terminal()], 'gone')).toBeNull()
  })
})

describe("the menu's connection line, in the Claude app's words (na20 ~L1003-1058)", () => {
  const line = (over: Partial<Parameters<typeof sessionConnectionLine>[0]> = {}) =>
    sessionConnectionLine({ connState: 'connected', unreachable: false, hostName: null, ...over })

  it('says Connected over a live link, and flags it as connected for the green tint', () => {
    expect(line()).toEqual({ text: 'Connected', connected: true })
    expect(line({ hostName: 'Alwin’s Mac' })).toEqual({ text: 'Connected', connected: true })
  })

  it('says Disconnected for a closed link, a revoked pairing, or a host the phone gave up on', () => {
    expect(line({ connState: 'disconnected' })).toEqual({ text: 'Disconnected', connected: false })
    expect(line({ connState: 'auth-failed' })).toEqual({ text: 'Disconnected', connected: false })
    expect(line({ connState: 'reconnecting', unreachable: true })).toEqual({ text: 'Disconnected', connected: false })
  })

  it('says Connecting… while the phone is still dialling, not Disconnected', () => {
    for (const connState of ['connecting', 'handshaking', 'reconnecting'] as const) {
      expect(line({ connState })).toEqual({ text: 'Connecting…', connected: false })
    }
  })

  it('names the host to reconnect from only when the phone has given up and knows its name', () => {
    expect(line({ connState: 'reconnecting', unreachable: true, hostName: 'Alwin’s Mac' })).toEqual({
      text: 'Disconnected • Reconnect from Alwin’s Mac',
      connected: false
    })
    expect(line({ connState: 'disconnected', hostName: 'Alwin’s Mac' })).toEqual({ text: 'Disconnected', connected: false })
    expect(line({ connState: 'reconnecting', unreachable: true, hostName: '  ' })).toEqual({ text: 'Disconnected', connected: false })
    expect(line({ connState: 'auth-failed', unreachable: false, hostName: 'Alwin’s Mac' }).text).toBe('Disconnected')
  })
})
