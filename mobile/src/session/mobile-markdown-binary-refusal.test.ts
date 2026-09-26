import { act, create } from 'react-test-renderer'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: { android?: unknown }) => o.android } }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))

import type { RpcFailure, RpcSuccess } from '../transport/types'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionDocumentReaders } from './use-mobile-session-document-readers'
import type { MobileSessionTabApplicationModel } from './use-mobile-session-tab-application'

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>
const TAB = { type: 'markdown', id: 'tab-md', relativePath: 'notes/utf16.md', isDirty: false } as unknown as MarkdownTab
const ok = (result: unknown): RpcSuccess => ({ id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } })
const fail = (code: string, message: string): RpcFailure => ({
  id: '1',
  ok: false,
  error: { code, message },
  _meta: { runtimeId: 'runtime-1' }
})
const UTF16 = 'R\u0000E\u0000A\u0000D\u0000M\u0000E\u0000'

async function read(readTab: RpcFailure) {
  let docs = new Map<string, unknown>()
  const client = {
    sendRequest: vi.fn(async (method: string) =>
      method === 'markdown.readTab' ? readTab : method === 'files.read' ? ok({ content: UTF16, truncated: false }) : fail('method_not_found', method)
    )
  }
  const scope = {
    worktreeId: 'wt-1',
    client,
    setMarkdownDocs: (next: unknown) => {
      docs = typeof next === 'function' ? (next as (p: typeof docs) => typeof docs)(docs) : (next as typeof docs)
    },
    setFileDocs: () => {},
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
    create(createElement(Probe))
  })
  await act(async () => {
    await readers.readMarkdownTab(TAB)
  })
  return { doc: docs.get(TAB.id) as Record<string, unknown>, methods: client.sendRequest.mock.calls.map(([m]) => m) }
}

// Second review of the file-open fix (2026-09-26): a binary refusal worded
// or wrapped otherwise than Orca's bare `binary_file` still read the disk.
describe('a binary refusal never draws the disk copy', () => {
  // Orca 1.4.197's shape: the renderer throws Error('binary_file'), main
  // re-throws it, mapRuntimeError sends it as the message.
  it.each([
    ['runtime_error / binary_file', fail('runtime_error', 'binary_file')],
    ['binary_file / binary_file (passthrough code)', fail('binary_file', 'binary_file')],
    ['binary_file / empty message', fail('binary_file', '')]
  ])('%s', async (_label, refusal) => {
    const { doc, methods } = await read(refusal)
    expect(doc.status).toBe('error')
    expect(methods).toEqual(['markdown.readTab'])
  })

  // No producer found in Orca's source for these two shapes; they show only
  // that the bar matches one exact string in one field.
  it.each([
    ['binary_file code with a human message', fail('binary_file', 'File is binary')],
    ['binary_file inside a wrapped message', fail('runtime_error', "Error invoking remote method 'fs:readFile': Error: binary_file")]
  ])('%s', async (_label, refusal) => {
    const { doc } = await read(refusal)
    expect(doc.status).toBe('error')
  })
})
