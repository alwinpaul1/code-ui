import { describe, expect, it } from 'vitest'
import { buildFileReaderLineMention } from './mobile-file-reader-line-mention'
import { formatNativeChatFileMentionToken } from './mobile-native-chat-file-mention'

describe('the whole-file mention ("Ask about file")', () => {
  it('is exactly what the @ autocomplete would insert for that path — the same formatter, not a lookalike', () => {
    expect(buildFileReaderLineMention('src/App.tsx', null, 'claude')).toBe(
      formatNativeChatFileMentionToken('src/App.tsx')
    )
  })

  it('carries no range for Codex either — there is nothing to range over', () => {
    expect(buildFileReaderLineMention('src/App.tsx', null, 'codex')).toBe('@src/App.tsx')
  })
})

describe('a single selected line', () => {
  it('appends #L<line> for Claude Code', () => {
    expect(buildFileReaderLineMention('src/App.tsx', { start: 10, end: 10 }, 'claude')).toBe(
      '@src/App.tsx#L10'
    )
  })

  it('is the first line of the file', () => {
    expect(buildFileReaderLineMention('src/App.tsx', { start: 1, end: 1 }, 'claude')).toBe(
      '@src/App.tsx#L1'
    )
  })
})

describe('a line range', () => {
  it('appends #L<start>-L<end> — both ends carry their own L, matching the VS Code extension', () => {
    expect(buildFileReaderLineMention('src/App.tsx', { start: 10, end: 20 }, 'claude')).toBe(
      '@src/App.tsx#L10-L20'
    )
  })
})

describe('Codex, whose #L convention is unverified', () => {
  it('drops the range rather than guess at syntax Codex 0.153 may not read', () => {
    expect(buildFileReaderLineMention('src/App.tsx', { start: 10, end: 20 }, 'codex')).toBe(
      '@src/App.tsx'
    )
  })
})

describe('an unresolved agent', () => {
  it('gets the Claude Code convention this gesture was ported from, not Codex\'s bare path', () => {
    expect(buildFileReaderLineMention('src/App.tsx', { start: 10, end: 20 }, null)).toBe(
      '@src/App.tsx#L10-L20'
    )
  })
})
