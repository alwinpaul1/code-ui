import { describe, expect, it } from 'vitest'
import { groupProseBlocks, imageLeadsText } from './mobile-native-chat-prose-groups'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'

const text = (t: string): NativeChatBlock => ({ type: 'text', text: t })
const img = (url: string): NativeChatBlock => ({ type: 'image-ref', url })

describe('groupProseBlocks', () => {
  it('folds several uploaded images into one sideways strip', () => {
    const groups = groupProseBlocks([
      text('look'),
      img('file:///a.png'),
      img('file:///b.png'),
      img('file:///c.png')
    ])
    expect(groups.map((g) => g.type)).toEqual(['block', 'image-strip'])
    expect(groups[1]).toMatchObject({ uris: ['file:///a.png', 'file:///b.png', 'file:///c.png'] })
  })

  it('leaves a single image as its own thumbnail', () => {
    const groups = groupProseBlocks([img('file:///a.png'), text('after')])
    expect(groups.map((g) => g.type)).toEqual(['block', 'block'])
  })

  it('does not pull a desktop-only path into a strip', () => {
    const groups = groupProseBlocks([
      img('file:///a.png'),
      { type: 'image-ref', path: '/Users/x/paste.png' },
      img('file:///b.png')
    ])
    expect(groups.map((g) => g.type)).toEqual(['block', 'block', 'block'])
  })

  it('spaces a picture from the caption under it, but not from another picture', () => {
    const groups = groupProseBlocks([img('file:///a.png'), text('caption')])
    expect(imageLeadsText(groups, 0)).toBe(true)
    expect(imageLeadsText(groups, 1)).toBe(false)
    const strip = groupProseBlocks([img('file:///a.png'), img('file:///b.png'), text('caption')])
    expect(imageLeadsText(strip, 0)).toBe(true)
    expect(imageLeadsText(groupProseBlocks([text('a'), img('file:///a.png')]), 0)).toBe(false)
  })

  // docs/claude-app-parity.md item 9: Claude Code's own `@"<path>"` file
  // mention, only read on the user's side of the turn.
  describe('a file mention in the text', () => {
    it('splits it into a file-cards group ahead of the remaining caption', () => {
      const groups = groupProseBlocks([text('@"/tmp/uploads/abcdef01-notes.pdf" see this')], {
        isUser: true
      })
      expect(groups).toEqual([
        { type: 'file-cards', cards: [{ path: '/tmp/uploads/abcdef01-notes.pdf', name: 'notes', ext: 'PDF' }] },
        { type: 'block', block: text('see this') }
      ])
    })

    it('drops the caption block entirely when the mention was the whole message', () => {
      const groups = groupProseBlocks([text('@"/tmp/uploads/abcdef01-notes.pdf"')], { isUser: true })
      expect(groups).toEqual([
        { type: 'file-cards', cards: [{ path: '/tmp/uploads/abcdef01-notes.pdf', name: 'notes', ext: 'PDF' }] }
      ])
    })

    it('leaves the text alone when isUser is not set, even with the same marker', () => {
      const groups = groupProseBlocks([text('@"/tmp/uploads/abcdef01-notes.pdf" see this')])
      expect(groups).toEqual([{ type: 'block', block: text('@"/tmp/uploads/abcdef01-notes.pdf" see this') }])
    })

    it('leaves ordinary user text with no mention untouched', () => {
      const groups = groupProseBlocks([text('run the full gate')], { isUser: true })
      expect(groups).toEqual([{ type: 'block', block: text('run the full gate') }])
    })
  })
})
