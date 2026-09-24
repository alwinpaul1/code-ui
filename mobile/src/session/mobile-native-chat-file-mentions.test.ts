import { describe, expect, it } from 'vitest'
import { parseFileMentionText } from './mobile-native-chat-file-mentions'

// The exact text of session 967668df-a7d9-40e7-964b-7812815c010d's
// "76514539-Screen_Recording" user row (Claude Code 2.1.281), byte for byte —
// including the doubled space before "in that sheet", which the transcript
// really has.
const REAL_MENTION_TEXT =
  '@"/Users/alwinpaul/.claude-work/uploads/967668df-a7d9-40e7-964b-7812815c010d/76514539-Screen_Recording_20260924_010304_Claude.mp4" See when a agent is running i can see that running using clicking on running task then  in that sheet there is a view transcript option to see the running agents transcript and in the conversation I can see animation an agent is running we need this all'

describe('parseFileMentionText', () => {
  it("pulls Claude Code's own file mention out of the real transcript row, dropping its upload id", () => {
    const { cards, caption } = parseFileMentionText(REAL_MENTION_TEXT)
    expect(cards).toEqual([
      {
        path: '/Users/alwinpaul/.claude-work/uploads/967668df-a7d9-40e7-964b-7812815c010d/76514539-Screen_Recording_20260924_010304_Claude.mp4',
        name: 'Screen_Recording_20260924_010304_Claude',
        ext: 'MP4'
      }
    ])
    expect(caption).toBe(
      'See when a agent is running i can see that running using clicking on running task then  in that sheet there is a view transcript option to see the running agents transcript and in the conversation I can see animation an agent is running we need this all'
    )
  })

  it('leaves plain text with no mention untouched', () => {
    expect(parseFileMentionText('just words, no attachment')).toEqual({
      cards: [],
      caption: 'just words, no attachment'
    })
  })

  it('leaves a quoted string that is not an absolute path alone, since it is not a file mention', () => {
    // No leading `/`: nothing Claude Code's own marker would ever record.
    expect(parseFileMentionText('ping @"someone" about it')).toEqual({
      cards: [],
      caption: 'ping @"someone" about it'
    })
  })

  it('finds each mention in a message that names more than one file', () => {
    const text = '@"/tmp/a.pdf" and @"/tmp/b.png" please'
    const { cards, caption } = parseFileMentionText(text)
    expect(cards.map((c) => c.name)).toEqual(['a', 'b'])
    expect(cards.map((c) => c.ext)).toEqual(['PDF', 'PNG'])
    expect(caption).toBe('and please')
  })

  it('badges no extension for a mention with none, rather than inventing one', () => {
    const { cards } = parseFileMentionText('@"/tmp/uploads/abcdef01-README"')
    expect(cards).toEqual([{ path: '/tmp/uploads/abcdef01-README', name: 'README', ext: '' }])
  })

  it('leaves the caption empty when the whole message is one mention', () => {
    const { cards, caption } = parseFileMentionText('@"/tmp/uploads/abcdef01-a.mp4"')
    expect(cards).toHaveLength(1)
    expect(caption).toBe('')
  })

  it('does not touch a name that only looks like an upload id, one digit short', () => {
    // 7 hex chars, not 8: not Claude Code's upload id shape, so it stays.
    const { cards } = parseFileMentionText('@"/tmp/1234567-file.txt"')
    expect(cards).toEqual([{ path: '/tmp/1234567-file.txt', name: '1234567-file', ext: 'TXT' }])
  })
})
