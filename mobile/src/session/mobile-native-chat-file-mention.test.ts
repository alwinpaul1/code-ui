import { describe, expect, it } from 'vitest'
import { formatNativeChatFileMentionToken } from './mobile-native-chat-file-mention'

describe('the @file mention token', () => {
  it('is an @ followed by the worktree-relative path, verbatim', () => {
    expect(formatNativeChatFileMentionToken('src/App.tsx')).toBe('@src/App.tsx')
  })

  it('does not alter a path that already contains special characters', () => {
    expect(formatNativeChatFileMentionToken('src/components/[id].tsx')).toBe(
      '@src/components/[id].tsx'
    )
  })
})
