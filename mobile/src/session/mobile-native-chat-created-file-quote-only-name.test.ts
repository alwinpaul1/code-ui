// Review of c6d8394a (2026-09-26): a created file whose name is only quote
// characters squashes to '', and matching an empty name never ended, which
// froze the app's JS thread when the run mounted. A synchronous loop cannot be
// stopped by a test timeout, so this guards String.prototype.indexOf and
// throws after 100k empty searches.

import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { cutCreateStandings } from './mobile-native-chat-created-file-count'

const MOBILE_CUT = '… (truncated)'
const originalIndexOf = String.prototype.indexOf

afterEach(() => {
  String.prototype.indexOf = originalIndexOf
})

function guardEmptySearches(): void {
  let empty = 0
  String.prototype.indexOf = function guarded(this: string, search: string, position?: number) {
    if (search === '') {
      empty += 1
      if (empty > 100_000) {
        throw new Error('namesFile looped on an empty name')
      }
    }
    return originalIndexOf.call(this, search, position)
  }
}

function transcript(path: string, command: string): NativeChatMessage[] {
  return [
    {
      id: 'write',
      role: 'assistant',
      blocks: [
        {
          type: 'tool-call',
          name: 'Write',
          input: { file_path: path, content: `${'line\n'.repeat(800)}${MOBILE_CUT}` }
        }
      ],
      timestamp: null,
      source: 'transcript'
    },
    {
      id: 'bash',
      role: 'assistant',
      blocks: [{ type: 'tool-call', name: 'Bash', input: { command } }],
      timestamp: null,
      source: 'transcript'
    }
  ]
}

describe('a created file named only in quote characters', () => {
  it('reads the transcript of an ordinary name', () => {
    guardEmptySearches()
    expect(() => cutCreateStandings(transcript('/Users/me/proj/notes.md', 'ls'))).not.toThrow()
  })

  it.each([`'`, `''`, '"', '`'])('reads the transcript without hanging for a file named %s', (name) => {
    guardEmptySearches()
    expect(() => cutCreateStandings(transcript(`/Users/me/proj/${name}`, 'ls'))).not.toThrow()
  })
})
