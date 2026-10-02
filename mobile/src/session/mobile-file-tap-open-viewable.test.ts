import { describe, expect, it, vi } from 'vitest'
import { openMobileFileTap } from './mobile-file-tap-open'

// Orca 1.4.218 answers files.open for a PDF with `opened: false`, kind `binary` (reported
// 2026-10-02: "binary files don't open on the phone" on a PDF the phone draws itself). Stand-in
// file names; the reply shapes are the ones the existing tap tests use.
function ok(result: unknown) {
  return { id: 'rpc-1', ok: true as const, result, _meta: { runtimeId: 'runtime-1' } }
}

function resolved(relativePath: string) {
  return ok({
    worktree: 'wt-1',
    relativePath,
    absolutePath: `/repo/${relativePath}`,
    exists: true,
    isDirectory: false,
    openTarget: {
      kind: 'worktree-file',
      provider: 'local',
      relativePath,
      absolutePath: `/repo/${relativePath}`
    }
  })
}

function tap(relativePath: string) {
  const client = {
    sendRequest: vi.fn(async (method: string) =>
      method === 'files.open'
        ? ok({ worktree: 'wt-1', relativePath, kind: 'binary', opened: false })
        : resolved(relativePath)
    )
  }
  const pushPreviewRoute = vi.fn()
  const onOpenFailed = vi.fn()
  openMobileFileTap({
    client,
    hostId: 'host-1',
    worktreeId: 'wt-1',
    worktreeName: 'Orca',
    pathText: relativePath,
    line: null,
    column: null,
    pushPreviewRoute,
    openBrowser: vi.fn(),
    triggerOpenFeedback: vi.fn(),
    fetchSessionTabs: vi.fn(),
    getSessionTabs: () => [],
    getActiveSessionTabId: () => null,
    getActivationState: (activated: boolean) => ({
      activated,
      activationSeq: 1,
      latestActivationSeq: 1,
      sourceTerminalHandle: 'terminal-1',
      activeTerminalHandle: 'terminal-1',
      activeTabType: 'terminal'
    }),
    switchSessionTab: vi.fn(),
    scheduleDelayedAction: vi.fn(),
    onOpenFailed
  })
  return { client, pushPreviewRoute, onOpenFailed }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('tapping a file the phone draws itself, in the session worktree', () => {
  it.each(['reports/draft_2026.pdf', 'shots/Screen.PDF', 'shots/home.png', 'shots/photo.JPG'])(
    'opens %s in the phone viewer without asking the desktop for a tab',
    async (path) => {
      const { client, pushPreviewRoute, onOpenFailed } = tap(path)
      await settle()

      expect(pushPreviewRoute).toHaveBeenCalledWith({
        pathname: '/h/[hostId]/files/preview/[worktreeId]',
        params: expect.objectContaining({
          hostId: 'host-1',
          worktreeId: 'wt-1',
          source: 'worktree',
          relativePath: path,
          worktreeName: 'Orca'
        })
      })
      expect(client.sendRequest).not.toHaveBeenCalledWith(
        'files.open',
        expect.anything(),
        expect.anything()
      )
      expect(onOpenFailed).not.toHaveBeenCalled()
    }
  )

  it('still asks the desktop to open a file the phone shows as text', async () => {
    const { client, pushPreviewRoute } = tap('src/app.ts')
    await settle()

    expect(client.sendRequest).toHaveBeenCalledWith(
      'files.open',
      { worktree: 'id:wt-1', relativePath: 'src/app.ts' },
      { timeoutMs: 15_000 }
    )
    expect(pushPreviewRoute).not.toHaveBeenCalled()
  })

  it('still says a binary file the phone cannot draw does not open', async () => {
    const { pushPreviewRoute, onOpenFailed } = tap('assets/logo.psd')
    await settle()

    expect(pushPreviewRoute).not.toHaveBeenCalled()
    expect(onOpenFailed).toHaveBeenCalledWith({ kind: 'not-openable', fileKind: 'binary' })
  })
})
