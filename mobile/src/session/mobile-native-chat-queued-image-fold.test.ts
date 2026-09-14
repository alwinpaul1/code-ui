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
