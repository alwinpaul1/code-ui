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

// What Orca 1.4.218's openMobileFile answers: a raster image opens a desktop tab, a PDF, zip or
// similar is declined as binary.
function openReply(relativePath: string) {
  return /\.(png|jpe?g)$/i.test(relativePath)
    ? ok({ worktree: 'wt-1', relativePath, kind: 'image', opened: true })
    : ok({ worktree: 'wt-1', relativePath, kind: 'binary', opened: false })
}

function tap(relativePath: string) {
  const client = {
    sendRequest: vi.fn(async (method: string) =>
      method === 'files.open' ? openReply(relativePath) : resolved(relativePath)
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

describe('tapping a PDF the phone draws itself, in the session worktree', () => {
  it.each(['reports/draft_2026.pdf', 'shots/Screen.PDF'])(
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

  it.each(['shots/home.png', 'shots/photo.JPG'])(
    'still opens %s as a desktop tab, which the desktop does for images',
    async (path) => {
      const { client, pushPreviewRoute, onOpenFailed } = tap(path)
      await settle()

      expect(client.sendRequest).toHaveBeenCalledWith(
        'files.open',
        { worktree: 'id:wt-1', relativePath: path },
        { timeoutMs: 15_000 }
      )
      expect(pushPreviewRoute).not.toHaveBeenCalled()
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
    const { pushPreviewRoute, onOpenFailed } = tap('dist/archive.zip')
    await settle()

    expect(pushPreviewRoute).not.toHaveBeenCalled()
    expect(onOpenFailed).toHaveBeenCalledWith({ kind: 'not-openable', fileKind: 'binary' })
  })
})

// 2026-10-10: the phone plays video and music itself since the #26148 port, but a
// path tapped in the chat still went to the desktop's files.open, which answers
// `binary`, so the tap said "binary files don't open on the phone".
describe('tapping a video or music file the phone plays itself, in the session worktree', () => {
  it.each(['media/demo.mp4', 'media/clip.MOV', 'audio/voice.m4a', 'audio/song.mp3'])(
    'opens %s in the phone player without asking the desktop for a tab',
    async (path) => {
      const { client, pushPreviewRoute, onOpenFailed } = tap(path)
      await settle()

      expect(pushPreviewRoute).toHaveBeenCalledWith({
        pathname: '/h/[hostId]/files/preview/[worktreeId]',
        params: expect.objectContaining({ worktreeId: 'wt-1', source: 'worktree', relativePath: path })
      })
      expect(client.sendRequest).not.toHaveBeenCalledWith('files.open', expect.anything(), expect.anything())
      expect(onOpenFailed).not.toHaveBeenCalled()
    }
  )
})
