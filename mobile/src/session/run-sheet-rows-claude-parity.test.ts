import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { runSheetRows, type RunSheetRow } from './mobile-native-chat-run-sheet-rows'

const drawn = (row: RunSheetRow): string => (row.detail ? `${row.verb}  ${row.detail}` : row.verb)
const rowsOf = (blocks: NativeChatBlock[]) => runSheetRows(blocks, [])

// The Claude app's sheet of 2026-10-09 (same session, side by side with ours):
// a ToolSearch row reads "Loaded tools" and nothing else. Ours read "Used
// ToolSearch  max_results". Orca's tool_use for it is
// {"query": "select:…", "max_results": 1}; the detail picker took the first
// input key in ALPHABETICAL order, so a parameter's NAME stood where a detail
// belongs. A call with several inputs has no key worth naming.
describe('a row for a tool the phone has no verb for', () => {
  const callOf = (name: string, input: unknown): NativeChatBlock[] => [
    { type: 'tool-call', name, input, state: 'completed' },
    { type: 'tool-result', output: 'ok' }
  ]
  const TOOL_SEARCH = { query: 'select:WebFetch,WebSearch', max_results: 1 }

  it('labels ToolSearch "Loaded tools", with no detail', () => {
    const row = rowsOf(callOf('ToolSearch', TOOL_SEARCH))[0]!
    expect(drawn(row)).toBe('Loaded tools')
    expect(row.detail).toBeNull()
    expect(row.detailIsKey).toBe(false)
  })

  it('does the same for ToolSearch as Codex hands it, its arguments a JSON string', () => {
    expect(drawn(rowsOf(callOf('ToolSearch', JSON.stringify(TOOL_SEARCH)))[0]!)).toBe('Loaded tools')
  })

  it('never names a parameter when the call has several, whichever sorts first', () => {
    const row = rowsOf(callOf('CronCreate', { schedule: '* * * * *', prompt: 'x', recurring: true }))[0]!
    expect(drawn(row)).toBe('Used CronCreate')
    expect(row.detailIsKey).toBe(false)
  })

  it('keeps the lone key of a one-input tool, as the 2026-10-01 CronDelete screenshot shows it', () => {
    const row = rowsOf(callOf('CronDelete', { id: '80ceeb4b' }))[0]!
    expect(drawn(row)).toBe('Used CronDelete  id')
    expect(row.detailIsKey).toBe(true)
  })
})

// The Claude app draws a created or edited file by its name in the monospace
// face, with the +N / −N chips the transcript's collapsed row draws.
describe('a row for a file the run created or edited', () => {
  const NEW_FILE = Array.from({ length: 32 }, (_, i) => `line ${i}`).join('\n') + '\n'

  it('carries the created file as a monospace name with its line counts', () => {
    const rows = rowsOf([
      { type: 'tool-call', name: 'Write', input: { file_path: '/repo/REVIEW3_BRIEF.md', content: NEW_FILE }, state: 'completed' },
      { type: 'tool-result', output: 'File created successfully at: /repo/REVIEW3_BRIEF.md' }
    ])
    expect(drawn(rows[0]!)).toBe('Created  REVIEW3_BRIEF.md')
    expect(rows[0]!.detailMono).toBe(true)
    expect(rows[0]!.diff).toEqual({ added: 32, removed: 0 })
  })

  it("carries an edit's own counts", () => {
    const rows = rowsOf([
      { type: 'tool-call', name: 'Edit', input: { file_path: '/repo/src/b.ts', old_string: 'a\nb', new_string: 'c' }, state: 'completed' },
      { type: 'tool-result', output: 'ok' }
    ])
    expect(rows[0]!.detailMono).toBe(true)
    expect(rows[0]!.diff).toEqual({ added: 1, removed: 2 })
  })

  it('draws no chips for a file the call failed to write', () => {
    const rows = rowsOf([
      { type: 'tool-call', name: 'Write', input: { file_path: '/repo/x.md', content: 'a\n' }, state: 'failed' },
      { type: 'tool-result', output: 'denied', isError: true }
    ])
    expect(rows[0]!.diff).toBeNull()
  })

  it('draws no chips on a row that is not a file edit, and a name in the sans face', () => {
    const row = rowsOf([
      { type: 'tool-call', name: 'Read', input: { file_path: '/repo/src/app.ts' } },
      { type: 'tool-result', output: 'x' }
    ])[0]!
    expect(row.diff).toBeNull()
    expect(row.detailMono).toBe(false)
  })
})
