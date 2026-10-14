import { describe, expect, it } from 'vitest'
import { parseFileMentionText, takeUserUploads, uploadOpensOnPhone } from './mobile-native-chat-file-mentions'

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

// This session's own user row (Claude Code, 2026-10-14): two screen
// recordings dropped into the prompt, then the words, as the transcript
// holds them.
const REAL_TWO_RECORDINGS =
  '@"/Users/alwinpaul/.claude-work/uploads/211c47c2-7a42-4c86-9a59-eaa0905d39e6/9fc7b823-Screen_Recording_20261014_133056_Code_UI.mp4" @"/Users/alwinpaul/.claude-work/uploads/211c47c2-7a42-4c86-9a59-eaa0905d39e6/44b1dd40-Screen_Recording_20261014_133136_Claude.mp4" See thr difference in codeui and claude mobile when I copy and scroll down it switches so see how decompiled claude does that and do that'

// The same session, an earlier upload sent from the phone: Orca's own
// attachment note (mobile-native-chat-file-attachment.ts), then the words.
const REAL_ATTACHED_NOTE =
  'Attached file "Screen_Recording_20261014_030357_Code UI.mp4" is on this machine at /var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1791939852431-edb95dfe-e7cb-4c5e-a031-d9da2f84479e.png. The .png extension is only the upload container; move it to a path ending in ".mp4" before reading it.\n\nSince auth code isn\'t signed in this happened'

describe('takeUserUploads', () => {
  it('takes both recordings of a real two-upload prompt out of its text, in order, and keeps the words', () => {
    const { cards, blocks } = takeUserUploads([{ type: 'text', text: REAL_TWO_RECORDINGS }])
    expect(cards.map((card) => [card.name, card.ext])).toEqual([
      ['Screen_Recording_20261014_133056_Code_UI', 'MP4'],
      ['Screen_Recording_20261014_133136_Claude', 'MP4']
    ])
    expect(blocks).toEqual([
      {
        type: 'text',
        text: 'See thr difference in codeui and claude mobile when I copy and scroll down it switches so see how decompiled claude does that and do that'
      }
    ])
  })

  it("cards Orca's own attachment note by the file's real name, not the .png container", () => {
    const { cards, blocks } = takeUserUploads([{ type: 'text', text: REAL_ATTACHED_NOTE }])
    expect(cards).toEqual([
      {
        path: '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1791939852431-edb95dfe-e7cb-4c5e-a031-d9da2f84479e.png',
        name: 'Screen_Recording_20261014_030357_Code UI',
        ext: 'MP4',
        container: true
      }
    ])
    expect(blocks).toEqual([{ type: 'text', text: "Since auth code isn't signed in this happened" }])
  })

  it('cards a note for a file with no extension, whose rename sentence differs', () => {
    const note =
      'Attached file "README" is on this machine at /var/folders/0y/x/T/orca-paste-1-a.png. The .png extension is only the upload container; rename it before reading it.'
    const { cards, blocks } = takeUserUploads([{ type: 'text', text: note }])
    expect(cards.map((card) => [card.name, card.ext])).toEqual([['README', '']])
    expect(blocks).toEqual([])
  })

  it('keeps a note that is cut short as text, rather than guessing at it', () => {
    const cut = 'Attached file "a.mp4" is on this machine at /var/folders/0y/x/T/orca-paste-1-a.png. The .png'
    const { cards, blocks } = takeUserUploads([{ type: 'text', text: cut }])
    expect(cards).toEqual([])
    expect(blocks).toEqual([{ type: 'text', text: cut }])
  })

  it('keeps a mention whose quote does not close at the path as text', () => {
    const malformed = 'look @"/tmp/uploads/abcdef01-a"b.pdf" here'
    const { cards, blocks } = takeUserUploads([{ type: 'text', text: malformed }])
    expect(cards).toEqual([])
    expect(blocks).toEqual([{ type: 'text', text: malformed }])
  })

  it('reads a path with spaces in it whole', () => {
    const { cards, blocks } = takeUserUploads([
      { type: 'text', text: '@"/Users/me/My Files/abcdef01-Quarter report final.pdf" summarise' }
    ])
    expect(cards).toEqual([
      { path: '/Users/me/My Files/abcdef01-Quarter report final.pdf', name: 'Quarter report final', ext: 'PDF' }
    ])
    expect(blocks).toEqual([{ type: 'text', text: 'summarise' }])
  })

  it('returns the blocks as they were when there is no upload', () => {
    const input = [{ type: 'text' as const, text: 'run the full gate' }]
    const { cards, blocks } = takeUserUploads(input)
    expect(cards).toEqual([])
    expect(blocks).toBe(input)
  })

  it('returns nothing for a message with no blocks', () => {
    expect(takeUserUploads([])).toEqual({ cards: [], blocks: [] })
  })

  it('leaves image and other blocks where they are', () => {
    const image = { type: 'image-ref' as const, url: 'file:///a.png', alt: 'Image' }
    const { cards, blocks } = takeUserUploads([image, { type: 'text', text: '@"/tmp/abcdef01-a.pdf" and this' }])
    expect(cards).toHaveLength(1)
    expect(blocks).toEqual([image, { type: 'text', text: 'and this' }])
  })
})

describe('uploadOpensOnPhone', () => {
  const card = (path: string) => parseFileMentionText(`@"${path}"`).cards[0]!

  it('opens the kinds the file reader already reads from a host path', () => {
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.pdf'))).toBe(true)
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.md'))).toBe(true)
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.png'))).toBe(true)
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.txt'))).toBe(true)
  })

  it('does not open a video, an unknown extension, or a file with none', () => {
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.mp4'))).toBe(false)
    expect(uploadOpensOnPhone(card('/u/abcdef01-a.xyz'))).toBe(false)
    expect(uploadOpensOnPhone(card('/u/abcdef01-README'))).toBe(false)
  })

  it("never opens an Orca note's .png container, whatever the file inside is", () => {
    const { cards } = takeUserUploads([
      {
        type: 'text',
        text: 'Attached file "notes.pdf" is on this machine at /var/folders/0y/x/T/orca-paste-1-a.png. The .png extension is only the upload container; move it to a path ending in ".pdf" before reading it.'
      }
    ])
    expect(uploadOpensOnPhone(cards[0]!)).toBe(false)
  })
})
