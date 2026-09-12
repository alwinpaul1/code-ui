import { describe, expect, it } from 'vitest'
import { groupProseBlocks } from './mobile-native-chat-prose-groups'
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
})
