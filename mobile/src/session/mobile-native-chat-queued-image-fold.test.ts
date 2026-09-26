import { describe, expect, it } from 'vitest'
import { normalizeImageTranscriptMessages } from '../../../src/shared/native-chat-image-transcript-markers'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldQueuedImageTurns } from './mobile-native-chat-queued-image-fold'

const user = (id: string, text: string): NativeChatMessage => ({
  id,
  role: 'user',
  timestamp: null,
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})
const assistant = (id: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  timestamp: null,
  source: 'transcript',
  blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'x' } }]
})

/** The shape the phone actually renders: this pass reorders the raw transcript
 *  first, then the vendored normalizer folds — the order the fold pipeline uses. */
function pipeline(messages: NativeChatMessage[]): NativeChatMessage[] {
  return normalizeImageTranscriptMessages(foldQueuedImageTurns(messages))
}

function summary(messages: NativeChatMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    types: message.blocks.map((block) => block.type)
  }))
}

describe('queued-message images fold into their prompt', () => {
  it("pulls a queued message's images down into the prompt across the agent's turns", () => {
    // 2026-09-14, from the phone: a queued message's two pasted screenshots
    // rendered as their own turns ABOVE the message bubble, because the agent
    // ran commands between the paste and the prompt's delivery.
    const out = pipeline([
      assistant('ran'),
      user('img1', '[Image: source: /t/140.png]'),
      user('img2', '[Image: source: /t/141.png]'),
      assistant('work'),
      user('prompt', '[Image #140] [Image #141] see these issues')
    ])
    expect(summary(out)).toEqual([
      { id: 'ran', role: 'assistant', types: ['tool-call'] },
      { id: 'work', role: 'assistant', types: ['tool-call'] },
      { id: 'prompt', role: 'user', types: ['image-ref', 'image-ref', 'text'] }
    ])
    const prompt = out.find((message) => message.id === 'prompt')!
    const text = prompt.blocks.find((block) => block.type === 'text') as { text: string }
    expect(text.text).toBe('see these issues')
  })

  it('still folds when the images and prompt are already adjacent', () => {
    const out = pipeline([
      user('img1', '[Image: source: /t/140.png]'),
      user('prompt', '[Image #140] look')
    ])
    expect(summary(out)).toEqual([
      { id: 'prompt', role: 'user', types: ['image-ref', 'text'] }
    ])
  })

  it('leaves a photo sent on its own alone, with no marker prompt to claim it', () => {
    const out = pipeline([
      user('photo', '[Image: source: /t/solo.png]'),
      assistant('reply')
    ])
    expect(summary(out)).toEqual([
      { id: 'photo', role: 'user', types: ['image-ref'] },
      { id: 'reply', role: 'assistant', types: ['tool-call'] }
    ])
  })

  it('does not fold when the marker count does not match the stranded images', () => {
    // One image stranded, a prompt naming two: not this prompt's images.
    const out = pipeline([
      user('img1', '[Image: source: /t/140.png]'),
      assistant('work'),
      user('prompt', '[Image #140] [Image #141] two images')
    ])
    expect(summary(out)).toEqual([
      { id: 'img1', role: 'user', types: ['image-ref'] },
      { id: 'work', role: 'assistant', types: ['tool-call'] },
      { id: 'prompt', role: 'user', types: ['text'] }
    ])
  })

  // 2026-09-26, Claude Code 2.1.281, session 967668df lines 23621 to 23682:
  // two messages sent from the phone with three photos each. Claude writes
  // each companion right AFTER its prompt, so the first one's companion was
  // pulled down to the second message, which drew the first message's photos,
  // and the second's own companion was left as a bubble of chips, no words.
  it.each([
    ['three photos each', 3],
    ['one photo each', 1]
  ])('keeps each message’s photos with it when the next message has as many, %s', (_label, count) => {
    const markers = (first: number) =>
      Array.from({ length: count }, (_, index) => `[Image #${first + index}]`).join(' ')
    const sources = (id: string, from: number) => ({
      ...user(id, ''),
      blocks: Array.from({ length: count }, (_, index) => ({
        type: 'text' as const,
        text: `[Image: source: /t/${from + index}.png]`
      }))
    })
    const out = pipeline([
      user('p1', `${markers(67)} first message`),
      sources('c1', 67),
      assistant('reply'),
      user('p2', `${markers(70)} second message`),
      sources('c2', 70)
    ])
    const image = Array.from({ length: count }, () => 'image-ref')
    expect(summary(out)).toEqual([
      { id: 'p1', role: 'user', types: [...image, 'text'] },
      { id: 'reply', role: 'assistant', types: ['tool-call'] },
      { id: 'p2', role: 'user', types: [...image, 'text'] }
    ])
    const paths = (id: string) =>
      out.find((message) => message.id === id)!.blocks.flatMap((block) => (block.type === 'image-ref' ? [block.path] : []))
    expect(paths('p2')).toEqual(Array.from({ length: count }, (_, index) => `/t/${70 + index}.png`))
  })

  // Review, 2026-09-26: 3 of the 617 companion runs on this machine are two
  // photo messages written back to back. The second prompt then has the
  // first one's companion in front of it, and was read as having taken it.
  it('keeps the second of two photo messages written back to back with its own photo, not the next one’s', () => {
    const out = pipeline([
      assistant('a0'),
      user('p1', '[Image #1] first photo message'),
      user('c1', '[Image: source: /t/one.png]'),
      user('p2', '[Image #2] second photo message'),
      user('c2', '[Image: source: /t/two.png]'),
      assistant('reply'),
      user('p3', '[Image #3] third photo message'),
      user('c3', '[Image: source: /t/three.png]')
    ])
    const paths = (id: string) =>
      out.find((message) => message.id === id)!.blocks.flatMap((block) => (block.type === 'image-ref' ? [block.path] : []))
    expect(out.map((message) => message.id)).toEqual(['a0', 'p1', 'p2', 'reply', 'p3'])
    expect([paths('p1'), paths('p2'), paths('p3')]).toEqual([['/t/one.png'], ['/t/two.png'], ['/t/three.png']])
  })

  it('leaves a photo whose message is on the page before the window where it is, not on the next message with as many', () => {
    const out = pipeline([
      user('c1', '[Image: source: /t/one.png]'),
      assistant('reply'),
      user('p2', '[Image #2] second photo message'),
      user('c2', '[Image: source: /t/two.png]')
    ])
    expect(summary(out)).toEqual([
      { id: 'c1', role: 'user', types: ['image-ref'] },
      { id: 'reply', role: 'assistant', types: ['tool-call'] },
      { id: 'p2', role: 'user', types: ['image-ref', 'text'] }
    ])
    const p2 = out.find((message) => message.id === 'p2')!
    expect(p2.blocks[0]).toMatchObject({ path: '/t/two.png' })
  })

  it('still moves a stranded run past a prompt that already has its own photos in front of it', () => {
    const out = pipeline([
      assistant('ran'),
      user('img0', '[Image: source: /t/1.png]'),
      user('p0', '[Image #1] mine'),
      user('img1', '[Image: source: /t/2.png]'),
      assistant('work'),
      user('queued', '[Image #2] queued')
    ])
    expect(summary(out)).toEqual([
      { id: 'ran', role: 'assistant', types: ['tool-call'] },
      { id: 'p0', role: 'user', types: ['image-ref', 'text'] },
      { id: 'work', role: 'assistant', types: ['tool-call'] },
      { id: 'queued', role: 'user', types: ['image-ref', 'text'] }
    ])
  })

  // Review, 2026-09-26: the page between two photo messages written back to
  // back can fall between the first prompt and its companion. The window then
  // starts with that companion, and the second prompt, which has its own
  // companion after it, drew the first message's photo.
  it('keeps each loaded message’s own photo when the window starts on the previous message’s companion', () => {
    const out = pipeline([
      user('c0', '[Image: source: /t/zero.png]'),
      user('p1', '[Image #1] second of two back to back'),
      user('c1', '[Image: source: /t/one.png]'),
      assistant('reply'),
      user('p2', '[Image #2] a later photo message'),
      user('c2', '[Image: source: /t/two.png]')
    ])
    const paths = (id: string) =>
      out.find((message) => message.id === id)!.blocks.flatMap((block) => (block.type === 'image-ref' ? [block.path] : []))
    expect(out.map((message) => message.id)).toEqual(['c0', 'p1', 'reply', 'p2'])
    expect([paths('c0'), paths('p1'), paths('p2')]).toEqual([['/t/zero.png'], ['/t/one.png'], ['/t/two.png']])
  })

  // The price of the rule above, taken knowingly: in the older order a queued
  // message's companion came first, and when the window starts on it, it is
  // now left where it is. 616 of the 617 companion runs on this machine trail
  // a prompt, and none is in the older order (review, 2026-09-26).
  it('leaves a photo the window starts with where it is, rather than pull it down to a later prompt', () => {
    const out = pipeline([
      user('cq', '[Image: source: /t/queued.png]'),
      assistant('work'),
      user('q1', '[Image #9] queued with a photo')
    ])
    expect(summary(out)).toEqual([
      { id: 'cq', role: 'user', types: ['image-ref'] },
      { id: 'work', role: 'assistant', types: ['tool-call'] },
      { id: 'q1', role: 'user', types: ['text'] }
    ])
  })

  it('returns nothing for nothing', () => {
    expect(foldQueuedImageTurns([])).toEqual([])
  })

  it('stops at an intervening user turn rather than reach across it', () => {
    const out = pipeline([
      user('img1', '[Image: source: /t/140.png]'),
      user('other', 'a different message with no markers'),
      user('prompt', '[Image #140] later')
    ])
    // The images do not leap past `other` into `prompt`.
    expect(out.find((message) => message.id === 'img1')?.blocks.map((block) => block.type)).toEqual([
      'image-ref'
    ])
  })
})
