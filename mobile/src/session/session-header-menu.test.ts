import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { renameSessionWorkspace, sessionHeaderMenuActions, sessionHeaderMenuEntries } from './session-header-menu'

// The header menu's session entries (parity gap G35) and what each does.

describe('which session entries the header menu offers', () => {
  const all = { branch: 'feature/header', runningTasks: 2, canOpenTasks: true, canRename: true, sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' }

  it("offers all four, in the Claude app's order, when the session has each", () => {
    expect(sessionHeaderMenuEntries(all)).toEqual(['copy-branch', 'background-tasks', 'rename', 'copy-session-id'])
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
    expect(sessionHeaderMenuEntries({ branch: null, runningTasks: 0, canOpenTasks: false, canRename: false, sessionId: null })).toEqual([])
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
