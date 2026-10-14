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

  // Reported 2026-10-11 (screenshot): the "Image on Desktop" chip for a
  // screenshot pasted on the desktop sat flush on the text under it, while a
  // loaded picture gets air below. The chip is a picture's stand-in and takes
  // the same space. The path is the real shape Orca's paste writes.
  it('spaces the "Image on Desktop" chip from the text under it, as a picture', () => {
    const paste: NativeChatBlock = {
      type: 'image-ref',
      path: '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1791732965258-6359231d-420f-40ec-a8fa-696466c27fe2.png'
    }
    const groups = groupProseBlocks([paste, text('also fix this')])
    expect(imageLeadsText(groups, 0)).toBe(true)
    expect(imageLeadsText(groupProseBlocks([paste]), 0)).toBe(false)
    expect(imageLeadsText(groupProseBlocks([paste, paste]), 0)).toBe(false)
  })

  // docs/claude-app-parity.md item 9: a prompt's `@"<path>"` uploads are
  // taken out before grouping (takeUserUploads) and drawn above the bubble,
  // so text that still holds the marker here is an agent quoting a path.
  it('leaves a quoted path in the text it is grouping as text', () => {
    const groups = groupProseBlocks([text('@"/tmp/uploads/abcdef01-notes.pdf" see this')])
    expect(groups).toEqual([{ type: 'block', block: text('@"/tmp/uploads/abcdef01-notes.pdf" see this') }])
  })
})
