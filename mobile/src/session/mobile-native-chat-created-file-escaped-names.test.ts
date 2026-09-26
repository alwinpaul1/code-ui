// Calls that name a created file in a shell's escaped spelling, or run code
// through a verb the count lets through, must void its count. Review of
// 8b2ef369 (2026-09-26): each of these was read as leaving the file alone.
// Controls: a quoted name, a plain `Add-Content` and a plain `cat` were
// already read right.

import { describe, expect, it } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { cutCreateOf, cutCreateStandings } from './mobile-native-chat-created-file-count'
import { CREATED_FILE_ON_DISK } from './fixtures/claude-edit-runs-2.1.282'

const CUT = '… (truncated)'

let nextId = 0
function message(role: 'assistant' | 'user', blocks: NativeChatBlock[]): NativeChatMessage {
  nextId += 1
  return { id: `m-${nextId}`, role, blocks, timestamp: null, source: 'transcript' }
}

function created(path: string): { key: string; rows: NativeChatMessage[] } {
  const call: NativeChatToolCallBlock = {
    type: 'tool-call',
    name: 'Write',
    input: { file_path: path, content: `${CREATED_FILE_ON_DISK.slice(0, 3896)}${CUT}` }
  }
  const result: NativeChatToolResultBlock = {
    type: 'tool-result',
    output: `File created successfully at: ${path}`
  }
  return {
    key: cutCreateOf(call, result)!.key,
    rows: [message('assistant', [call]), message('user', [result])]
  }
}

function ran(name: string, command: string): NativeChatMessage[] {
  return [
    message('assistant', [{ type: 'tool-call', name, input: { command, description: 'Tidy' } }]),
    message('user', [{ type: 'tool-result', output: '' }])
  ]
}

function touched(path: string, name: string, command: string): boolean | undefined {
  const create = created(path)
  return cutCreateStandings([...create.rows, ...ran(name, command)]).get(create.key)?.touched
}

describe('a call that names the created file in its escaped spelling', () => {
  // A Next.js dynamic route. zsh (Claude Code's shell on macOS) refuses an
  // unquoted `[slug]` as a glob with no match, so the brackets are escaped.
  const ROUTE = '/Users/dev/Desktop/Project/Site/pages/blog/[slug].tsx'

  it('draws no count after sed edits the route file its escaped name names', () => {
    expect(touched(ROUTE, 'Bash', "sed -i '' 's/draft/live/' pages/blog/\\[slug\\].tsx")).toBe(true)
  })

  it('draws no count after a command appends to the route file its escaped name names', () => {
    expect(touched(ROUTE, 'Bash', 'cat footer.tsx >> pages/blog/\\[slug\\].tsx')).toBe(true)
  })

  it('draws no count after PowerShell appends to the route file its backtick-escaped name names', () => {
    // PowerShell reads `[` in -Path as a wildcard, so the brackets are
    // escaped with its own escape character, the backtick.
    expect(
      touched(
        'C:\\Users\\dev\\Site\\pages\\blog\\[slug].tsx',
        'PowerShell',
        "Add-Content -Path pages\\blog\\`[slug`].tsx -Value 'export {}'"
      )
    ).toBe(true)
  })

  it("draws no count after sed edits a file whose apostrophe the command escapes", () => {
    expect(touched("/Users/dev/notes/it's-done.md", 'Bash', "sed -i '' 's/a/b/' it\\'s-done.md")).toBe(
      true
    )
  })
})

describe('PowerShell running code through a verb the count lets through', () => {
  const SCRIPT = 'C:\\Users\\dev\\proj\\queue.ps1'

  it('draws no count after cat is handed a script block that appends to the file', () => {
    // A delay-bind script block: Get-Content's -Path takes pipeline input by
    // property name, so PowerShell runs the block for each piped item.
    expect(
      touched(SCRIPT, 'PowerShell', "ls queue.ps1 | cat -Path {Add-Content queue.ps1 'Write-Host done'}")
    ).toBe(true)
  })

  it('draws no count after a bare carriage return starts a second PowerShell statement', () => {
    expect(touched(SCRIPT, 'PowerShell', "cat queue.ps1\rAdd-Content queue.ps1 'Write-Host done'")).toBe(
      true
    )
  })
})

describe('what an escape does not change', () => {
  it('still counts a create whose escaped name the next command only reads', () => {
    expect(touched('/Users/dev/Desktop/Project/Site/pages/blog/[slug].tsx', 'Bash', 'cat pages/blog/\\[slug\\].tsx')).toBe(false)
  })
})
