import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import type { MobileSessionTab } from '../session/mobile-session-route-types'
import { resolveMobileFileTabDoc } from './mobile-file-tab-doc'
import { nativeChatFileContextsOf } from './mobile-file-tab-session-contexts'
import { readWholeDesktopFile } from './mobile-file-whole-read'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

// Device, 0.9.151 (2026-10-15): project "main" had a Claude tab "TACO" and a
// file tab "BLADE_TACO_final….pdf", a PDF on the user's Desktop that the
// session had written about. The tab said only "File on Desktop. The phone can
// show it only while a terminal here still shows its path." (now "a terminal or chat here")
//
// Two things stood in the way, both on the phone:
// 1. The tab asked the host to vouch for the path through terminal handles
//    alone. Orca's terminal provenance grants only under the temp dir
//    (localTerminalArtifactRoots: tmpdir(), /tmp, /private/tmp), so a file
//    in ~/Desktop is never granted that way, whatever the terminal shows. The
//    provenance that does cover it is the native chat transcript: a
//    `nativeChatContext` of the Claude tab's id and its provider session id,
//    which Orca checks against the assistant text of that session
//    (nativeChatTranscriptIncludesPath, read at orca src/main/native-chat/
//    native-chat-file-provenance.ts). A chat tap already sends it; the tab never did.
// 2. A grant for a PDF threw outside_worktree on purpose ("the chunked read
//    has no grant form"), though files.readTerminalArtifactPreview serves a PDF
//    as base64 up to 10 MiB, which is how the chat tap's preview shows one.
//
// The host below vouches for the absolute spelling, which the real one did not:
// the real session wrote `~/Downloads/…`, and Orca matches the transcript word
// for word, so 0.9.152 still refused. Orca's own replies for that case are in
// mobile-file-tab-session-spelling.test.ts.
const PDF_PATH = '/Users/alwin/Desktop/BLADE_TACO_final.pdf'
const PDF_BASE64 = 'JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4KJSVFT0YK'
const SESSION_ID = '5b7c2d4e-1f3a-4c8b-9e2d-7a6f0c1b3d5e'

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'r' } }
}

// The Claude tab as the session-tab snapshot carries it: a terminal tab whose
// live agent status names the provider session.
const CLAUDE_TAB = {
  type: 'terminal',
  id: 'tab-taco',
  title: 'TACO',
  status: 'ready',
  terminal: 'term-taco',
  isActive: false,
  agentStatus: {
    agentType: 'claude',
    state: 'done',
    providerSession: {
      id: SESSION_ID,
      transcriptPath: `/Users/alwin/.claude/projects/-Users-alwin-main/${SESSION_ID}.jsonl`
    }
  }
} as unknown as MobileSessionTab
const PDF_TAB = {
  type: 'file',
  id: 'tab-pdf',
  title: 'BLADE_TACO_final.pdf',
  relativePath: PDF_PATH,
  filePath: PDF_PATH,
  isActive: true
} as unknown as MobileSessionTab
const SHELL_TAB = {
  type: 'terminal',
  id: 'tab-shell',
  title: 'zsh',
  status: 'ready',
  terminal: 'term-shell',
  isActive: false
} as unknown as MobileSessionTab

/** A host that answers resolveTerminalPath the way Orca does for a path in ~/Desktop. */
function desktopHost(transcriptShowsPath: boolean) {
  const resolves: Record<string, unknown>[] = []
  const methods: string[] = []
  const client = {
    sendRequest: (method: string, params: Record<string, unknown>) => {
      methods.push(method)
      if (method === 'files.resolveTerminalPath') {
        resolves.push(params)
        const context = params.nativeChatContext as { tabId?: string; sessionId?: string } | undefined
        const vouched =
          transcriptShowsPath && context?.tabId === 'tab-taco' && context.sessionId === SESSION_ID
        return Promise.resolve(
          ok(
            vouched
              ? {
                  worktree: 'wt-main',
                  relativePath: null,
                  absolutePath: PDF_PATH,
                  exists: true,
                  isDirectory: false,
                  openTarget: {
                    kind: 'absolute-file',
                    provider: 'local',
                    absolutePath: PDF_PATH,
                    grantId: 'grant-pdf',
                    readOnly: true
                  }
                }
              : // Terminal provenance outside the temp dir, or no provenance: Orca's `empty` with the paths.
                { worktree: 'wt-main', relativePath: null, absolutePath: PDF_PATH, exists: false, isDirectory: false }
          )
        )
      }
      if (method === 'files.readTerminalArtifactPreview') {
        expect(params).toMatchObject({ worktree: 'id:wt-main', absolutePath: PDF_PATH, grantId: 'grant-pdf' })
        return Promise.resolve(
          ok({ content: PDF_BASE64, isBinary: true, isImage: true, mimeType: 'application/pdf' })
        )
      }
      return Promise.reject(new Error(`unexpected method ${method}`))
    }
  }
  return { client, resolves, methods }
}

describe('a PDF on the Desktop that the Claude session wrote about', () => {
  it('opens in its file tab through the session the path appeared in', async () => {
    const host = desktopHost(true)
    const doc = await resolveMobileFileTabDoc(host.client as never, {
      worktreeId: 'wt-main',
      relativePath: PDF_PATH,
      terminalHandles: ['term-taco', 'term-shell'],
      nativeChatContexts: nativeChatFileContextsOf([SHELL_TAB, PDF_TAB, CLAUDE_TAB])
    })
    expect(doc).toEqual({ status: 'ready', kind: 'pdf', uri: `data:application/pdf;base64,${PDF_BASE64}` })
    expect(host.resolves.map((params) => params.nativeChatContext ?? params.terminal ?? 'bare')).toEqual([
      'term-taco',
      'term-shell',
      { tabId: 'tab-taco', sessionId: SESSION_ID }
    ])
  })

  it('saves to the phone through the same session', async () => {
    const host = desktopHost(true)
    const read = await readWholeDesktopFile(host.client as never, {
      source: 'fileTab',
      worktreeId: 'wt-main',
      path: PDF_PATH,
      terminalHandles: ['term-taco'],
      nativeChatContexts: nativeChatFileContextsOf([CLAUDE_TAB])
    })
    expect(read).toEqual({ status: 'read', base64: PDF_BASE64, byteLength: expect.any(Number) })
  })

  it('still says it is out of reach when no session showed the path', async () => {
    const host = desktopHost(false)
    await expect(
      resolveMobileFileTabDoc(host.client as never, {
        worktreeId: 'wt-main',
        relativePath: PDF_PATH,
        terminalHandles: ['term-taco'],
        nativeChatContexts: nativeChatFileContextsOf([CLAUDE_TAB])
      })
    ).rejects.toThrow('outside_worktree')
    expect(host.methods).not.toContain('files.readTerminalArtifactPreview')
  })

  it('names only agent terminal tabs with a provider session, and none of an empty list', () => {
    expect(nativeChatFileContextsOf([SHELL_TAB, PDF_TAB, CLAUDE_TAB])).toEqual([
      { tabId: 'tab-taco', sessionId: SESSION_ID }
    ])
    expect(nativeChatFileContextsOf([])).toEqual([])
    expect(nativeChatFileContextsOf([SHELL_TAB])).toEqual([])
  })
})
