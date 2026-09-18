import { describe, expect, it } from 'vitest'
import { appendMentionToDraftText } from './mobile-native-chat-draft-append-mention'

describe('appending a mention to the composer draft', () => {
  it('is just the mention plus a trailing space on an empty draft', () => {
    expect(appendMentionToDraftText('', '@src/App.tsx#L10-L20')).toBe('@src/App.tsx#L10-L20 ')
  })

  it('separates from existing text with one space, and still trails one', () => {
    expect(appendMentionToDraftText('take a look', '@src/App.tsx#L10-L20')).toBe(
      'take a look @src/App.tsx#L10-L20 '
    )
  })
})
