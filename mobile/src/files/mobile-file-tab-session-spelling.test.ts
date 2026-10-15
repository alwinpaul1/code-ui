import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import type { MobileSessionTab } from '../session/mobile-session-route-types'
import { resolveMobileFileTabDoc } from './mobile-file-tab-doc'
import { nativeChatFileContextsOf } from './mobile-file-tab-session-contexts'
import { readWholeDesktopFile } from './mobile-file-whole-read'
import {
  GRANT_ID,
  GRANTED_PREVIEW,
  HOST_HOME,
  JETCAS_SESSION_ID,
  JETCAS_TAB_ID,
  PDF_ABSOLUTE_PATH,
  PDF_AS_THE_SESSION_WROTE_IT,
  RESOLVE_REPLIES,
  TACO_SESSION_ID,
  TACO_TAB_ID,
  THESIS_SESSION_TABS,
  THESIS_WORKTREE_ID
} from './fixtures/orca-desktop-pdf-grant-1.4.224'

vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

// Device, 0.9.152 (2026-10-15): the file tab on BLADE_TACO_final_2026-10-10.pdf
// in project "main" still said "File on Desktop. The phone can show it only
// while a terminal or chat here still shows its path", though the TACO session
// beside it had named the PDF ten times. It named it `~/Downloads/…`, never the
// absolute path, and Orca checks a session's transcript for the request's
// `pathText` (and the path that expands to), word for word. The phone sent only
// the absolute path, which no assistant text contains. Every reply below is
// Orca 1.4.224's own (fixtures/orca-desktop-pdf-grant-1.4.224.ts).

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'r' } }
}

const TABS = THESIS_SESSION_TABS as unknown as MobileSessionTab[]

/** Replays the captured replies; a request nobody captured fails the test. */
function capturedHost(overrides: Record<string, unknown> = {}) {
  const resolves: string[] = []
  const methods: string[] = []
  const replies = { ...RESOLVE_REPLIES, ...overrides }
  const client = {
    sendRequest: (method: string, params: Record<string, unknown>) => {
      methods.push(method)
      if (method === 'files.resolveTerminalPath') {
        expect(params).toMatchObject({ worktree: `id:${THESIS_WORKTREE_ID}`, crossWorkspace: true })
        const context = params.nativeChatContext as { tabId: string; sessionId: string } | undefined
        if (context) {
          const tab = THESIS_SESSION_TABS.find((candidate) => candidate.id === context.tabId)
          expect(context.sessionId).toBe(
            tab && 'agentStatus' in tab ? tab.agentStatus.providerSession.id : undefined
          )
        }
        const key = `${String(params.pathText)} ${context?.tabId ?? '-'}`
        resolves.push(key)
        if (!(key in replies)) {
          return Promise.reject(new Error(`uncaptured resolve ${key}`))
        }
        return Promise.resolve(ok(replies[key]))
      }
      if (method === 'files.readTerminalArtifactPreview') {
        expect(params).toEqual({
          worktree: `id:${THESIS_WORKTREE_ID}`,
          absolutePath: PDF_ABSOLUTE_PATH,
          grantId: GRANT_ID
        })
        return Promise.resolve(ok(GRANTED_PREVIEW))
      }
      return Promise.reject(new Error(`unexpected method ${method}`))
    }
  }
  return { client, resolves, methods }
}

const PDF_DOC = {
  status: 'ready',
  kind: 'pdf',
  uri: `data:application/pdf;base64,${GRANTED_PREVIEW.content}`
}

describe('a file tab on a PDF the Claude session named as ~/…', () => {
  it('opens through the session, asking in the spelling the session wrote', async () => {
    const host = capturedHost()
    const doc = await resolveMobileFileTabDoc(host.client as never, {
      worktreeId: THESIS_WORKTREE_ID,
      relativePath: PDF_ABSOLUTE_PATH,
      nativeChatContexts: nativeChatFileContextsOf(TABS)
    })
    expect(doc).toEqual(PDF_DOC)
    expect(host.resolves).toContain(`${PDF_AS_THE_SESSION_WROTE_IT} ${TACO_TAB_ID}`)
  })

  it('saves to the phone through the same grant', async () => {
    const host = capturedHost()
    const read = await readWholeDesktopFile(host.client as never, {
      source: 'fileTab',
      worktreeId: THESIS_WORKTREE_ID,
      path: PDF_ABSOLUTE_PATH,
      terminalHandles: [],
      nativeChatContexts: nativeChatFileContextsOf(TABS)
    })
    expect(read).toEqual({ status: 'read', base64: GRANTED_PREVIEW.content, byteLength: expect.any(Number) })
  })

  it('still refuses when no session wrote the path in either spelling, and says who was asked', async () => {
    const host = capturedHost()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      resolveMobileFileTabDoc(host.client as never, {
        worktreeId: THESIS_WORKTREE_ID,
        relativePath: PDF_ABSOLUTE_PATH,
        // JETCAS alone: its assistant text never named the PDF.
        nativeChatContexts: nativeChatFileContextsOf(TABS.filter((tab) => tab.id === JETCAS_TAB_ID))
      })
    ).rejects.toThrow('outside_worktree')
    expect(host.methods).not.toContain('files.readTerminalArtifactPreview')
    const jetcas = JETCAS_SESSION_ID
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[file-tab]'), {
      path: PDF_ABSOLUTE_PATH,
      answers: [
        `session ${jetcas}: exists:false`,
        'no evidence: exists:false',
        `~/ lands at ${HOST_HOME}`,
        `session ${jetcas} as ${PDF_AS_THE_SESSION_WROTE_IT}: exists:false`
      ]
    })
    warn.mockRestore()
  })

  it('refuses a grant for any file but the tab’s own', async () => {
    const host = capturedHost({
      [`${PDF_AS_THE_SESSION_WROTE_IT} ${TACO_TAB_ID}`]: {
        worktree: THESIS_WORKTREE_ID,
        relativePath: null,
        absolutePath: '/Users/someone-else/Downloads/BLADE_TACO_final_2026-10-10.pdf',
        exists: true,
        isDirectory: false,
        openTarget: {
          kind: 'absolute-file',
          provider: 'local',
          absolutePath: '/Users/someone-else/Downloads/BLADE_TACO_final_2026-10-10.pdf',
          grantId: GRANT_ID,
          readOnly: true
        }
      }
    })
    await expect(
      resolveMobileFileTabDoc(host.client as never, {
        worktreeId: THESIS_WORKTREE_ID,
        relativePath: PDF_ABSOLUTE_PATH,
        nativeChatContexts: nativeChatFileContextsOf(TABS)
      })
    ).rejects.toThrow('outside_worktree')
    expect(host.methods).not.toContain('files.readTerminalArtifactPreview')
  })

  it('asks no ~ spelling when the host will not say where ~ is (an SSH worktree)', async () => {
    // Orca answers a `~/` request on an SSH worktree with no path at all.
    const host = capturedHost({
      ['~/ -']: { worktree: THESIS_WORKTREE_ID, relativePath: null, absolutePath: null, exists: false, isDirectory: false }
    })
    await expect(
      resolveMobileFileTabDoc(host.client as never, {
        worktreeId: THESIS_WORKTREE_ID,
        relativePath: PDF_ABSOLUTE_PATH,
        nativeChatContexts: nativeChatFileContextsOf(TABS)
      })
    ).rejects.toThrow('outside_worktree')
    expect(host.resolves.filter((key) => key.startsWith('~/Downloads'))).toEqual([])
  })

  it('asks no ~ spelling for a path outside the home directory, nor the home directory itself', async () => {
    for (const path of ['/Volumes/Data/BLADE_TACO_final_2026-10-10.pdf', HOST_HOME, `${HOST_HOME}x/a.pdf`]) {
      const host = capturedHost({ [`${path} ${TACO_TAB_ID}`]: {}, [`${path} ${JETCAS_TAB_ID}`]: {}, [`${path} -`]: {} })
      await expect(
        resolveMobileFileTabDoc(host.client as never, {
          worktreeId: THESIS_WORKTREE_ID,
          relativePath: path,
          nativeChatContexts: nativeChatFileContextsOf(TABS)
        })
      ).rejects.toThrow('outside_worktree')
      expect(host.resolves.filter((key) => key.startsWith('~/') && key !== '~/ -')).toEqual([])
    }
  })

  it('costs no extra request when no session is there to vouch', async () => {
    const host = capturedHost()
    await expect(
      resolveMobileFileTabDoc(host.client as never, {
        worktreeId: THESIS_WORKTREE_ID,
        relativePath: PDF_ABSOLUTE_PATH,
        nativeChatContexts: []
      })
    ).rejects.toThrow('outside_worktree')
    expect(host.resolves).toEqual([`${PDF_ABSOLUTE_PATH} -`])
  })

  it('names TACO by its own tab and session', () => {
    expect(nativeChatFileContextsOf(TABS)[0]).toEqual({ tabId: TACO_TAB_ID, sessionId: TACO_SESSION_ID })
  })
})
