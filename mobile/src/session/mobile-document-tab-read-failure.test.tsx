import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionDocumentReaders } from './use-mobile-session-document-readers'
import type { MobileSessionTabApplicationModel } from './use-mobile-session-tab-application'

vi.mock('react-native', () => ({ Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android } }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

// Reported from the phone on 2026-09-26 (build 4cab9d86, Orca 1.4.212): a
// markdown file picked from the "Files named …" sheet opened as a tab that
// said "Couldn't load markdown", and Retry said it again. The file was a
// 9 KB text file in the pane's own worktree. The desktop refused the tab
// read, and the phone fell back to the file on disk only for a desktop with
// no window, dropping every other reason unread.

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>
type FileTab = Extract<MobileSessionTab, { type: 'file' }>
const TAB = {
  type: 'markdown',
  id: 'tab-md',
  relativePath: 'taco_council_2026-09-19/algorithm_2026-09-26/black_text_changes_bridge.md',
  isDirty: false
} as unknown as MarkdownTab

const ok = (result: unknown): RpcSuccess => ({ id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } })
const fail = (code: string, message: string): RpcFailure => ({
  id: '1',
  ok: false,
  error: { code, message },
  _meta: { runtimeId: 'runtime-1' }
})

async function readWith(replies: Record<string, RpcSuccess | RpcFailure>, fileTab?: FileTab) {
  let docs = new Map<string, unknown>()
  const client = {
    sendRequest: vi.fn(async (method: string) => replies[method] ?? fail('method_not_found', method))
  }
  const scope = {
    worktreeId: 'wt-1',
    client,
    setMarkdownDocs: (next: unknown) => {
      docs = typeof next === 'function' ? (next as (prev: typeof docs) => typeof docs)(docs) : (next as typeof docs)
    },
    setFileDocs: (next: unknown) => {
      docs = typeof next === 'function' ? (next as (prev: typeof docs) => typeof docs)(docs) : (next as typeof docs)
    },
    terminalsRef: { current: [] },
    activeSessionTabId: null,
    sessionTabs: []
  } as unknown as MobileSessionTabApplicationModel
  let readers!: ReturnType<typeof useMobileSessionDocumentReaders>
  function Probe() {
    readers = useMobileSessionDocumentReaders(scope)
    return null
  }
  act(() => {
    create(<Probe />)
  })
  await act(async () => {
    await (fileTab ? readers.readFileTab(fileTab) : readers.readMarkdownTab(TAB))
  })
  return { doc: docs.get(fileTab?.id ?? TAB.id) as Record<string, unknown> | undefined, client }
}

describe('a markdown tab the desktop will not read', () => {
  it('shows the file from disk, read-only, with the desktop’s reason, instead of "Couldn’t load markdown"', async () => {
    const { doc, client } = await readWith({
      'markdown.readTab': fail('runtime_error', 'tab_not_found'),
      'files.read': ok({ content: '# Changes for Mahdi\n', isBinary: false, truncated: false })
    })
    expect(client.sendRequest).toHaveBeenCalledWith('files.read', expect.objectContaining({ relativePath: TAB.relativePath }))
    expect(doc).toMatchObject({ status: 'ready', content: '# Changes for Mahdi\n', editable: false })
    expect(String(doc?.readOnlyReason)).toContain('tab_not_found')
  })

  it('says why when the file cannot be read from disk either', async () => {
    const { doc } = await readWith({
      'markdown.readTab': fail('runtime_error', 'tab_not_found'),
      'files.read': fail('runtime_error', 'ENOENT')
    })
    expect(doc).toMatchObject({ status: 'error' })
    expect(String(doc?.message)).toContain('tab_not_found')
  })

  it('still reads the desktop’s own copy, editable, when it answers', async () => {
    const { doc, client } = await readWith({
      'markdown.readTab': ok({ content: '# Draft', version: 'v1', isDirty: false, editable: true })
    })
    expect(doc).toMatchObject({ status: 'ready', content: '# Draft', editable: true })
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual(['markdown.readTab'])
  })
})

describe('a file tab the desktop will not read', () => {
  it('says the desktop’s reason, not only "Couldn’t load file preview"', async () => {
    const tab = { type: 'file', id: 'tab-txt', relativePath: 'taco_council_2026-09-19/notes.txt' } as unknown as FileTab
    const { doc } = await readWith({ 'files.read': fail('runtime_error', 'EACCES: permission denied') }, tab)
    expect(doc).toMatchObject({ status: 'error' })
    expect(String(doc?.message)).toContain('EACCES')
  })
})
