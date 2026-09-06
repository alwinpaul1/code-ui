import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  findLandedImagePreviewEchoes,
  findLandedUnconfirmedSends,
  migrateImagePreviewMessageIds,
  type PendingImagePreviewEcho,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'

function userText(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

function pending(id: string, images: string[], expectedOccurrence = 1): PendingImagePreviewEcho {
  return { id, text: '', images, expectedOccurrence, baselineTailMessageId: null }
}

describe('mobile native chat image preview reconciliation', () => {
  it('binds a local thumbnail when the agent echoes the uploaded path before the caption', () => {
    const path =
      '/var/folders/0y/session/T/orca-paste-1788707946740-fd6147a9-5b2d-4051-8a87-dbd45992c21e.png'
    const messages = [userText('landed', path + ' look at this')]
    expect(
      findLandedImagePreviewEchoes(messages, [
        { ...pending('pending', ['file:///a.jpg']), text: 'look at this' }
      ])
    ).toEqual([{ pendingId: 'pending', messageId: 'landed', images: ['file:///a.jpg'] }])
  })

  it('reconciles a trailing-marker echo and hands its preview to that echo', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look at this[Image #1]')
    ]
    const preview = {
      ...pending('pending', ['file:///a.jpg']),
      text: 'look at this'
    }
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'look at this',
      normalizedText: 'look at this',
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends(messages, [unconfirmed])).toEqual([unconfirmed])
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('binds an image echo to the row it was glued into with a following send', () => {
    // Regression: a send issued while the agent was mid-turn glues onto the input line
    // with the send beside it, so the landed row's text is the concatenation. Demanding
    // the whole row equal this echo left it unbound — the phone-local photo never
    // reached the authoritative row and the echo could never be retired.
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look at this[Image #1] is it still working?')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look at this' }

    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('binds an image echo that was glued AFTER a text-only send (suffix of the row)', () => {
    // Seen on 0.2.18: "…does" sent text-only while the agent worked, then the photo
    // send "…does it" glued after it. The row read "…does [Image #1] …does it"; the
    // prefix-only matcher left the thumbnail echo queued forever beside a chips row.
    const messages = [
      userText('prompt', 'see how orca github does [Image #1] see how orca github does it'),
      userText('companion', '[Image: source: /tmp/a.png]')
    ]
    const preview = {
      ...pending('pending', ['file:///a.jpg']),
      text: 'see how orca github does it'
    }
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('does not bind an image echo to a row where its caption is only part of a word', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'please edit this[Image #1]')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'it' }
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([])
  })

  it('does not bind an image echo to a row that merely shares a word', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'totally different[Image #1]')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look at this' }

    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([])
  })

  it('does not bind a glued image echo to an ordinary row with the same prefix', () => {
    const messages = [
      userText('ordinary', 'look at this later'),
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look at this[Image #1] is it still working?')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look at this' }

    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('reconciles a middle-marker echo without changing its rendered whitespace', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look [Image #1] here')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look here' }
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'look here',
      normalizedText: 'look here',
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends(messages, [unconfirmed])).toEqual([unconfirmed])
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('reconciles multiple transcript text blocks with desktop separators', () => {
    const prompt: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'image-ref', path: '/tmp/a.png' },
        { type: 'text', text: '[Image #1] here' }
      ]
    }
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look here' }

    expect(findLandedImagePreviewEchoes([prompt], [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('keeps separate adjacent image-only sends independently reconcilable', () => {
    const landed = findLandedImagePreviewEchoes(
      [
        userText('source-a', '[Image: source: /tmp/a.png]'),
        userText('source-b', '[Image: source: /tmp/b.png]')
      ],
      [pending('pending-a', ['file:///a.jpg']), pending('pending-b', ['file:///b.jpg'], 2)]
    )

    expect(landed).toEqual([
      { pendingId: 'pending-a', messageId: 'source-a', images: ['file:///a.jpg'] },
      { pendingId: 'pending-b', messageId: 'source-b', images: ['file:///b.jpg'] }
    ])
  })

  it('waits for a complete multi-image turn as transcript source frames stream in', () => {
    const entry = pending('pending', ['file:///a.jpg', 'file:///b.jpg'])
    const sourceA = userText('source-a', '[Image: source: /tmp/a.png]')
    const sourceB = userText('source-b', '[Image: source: /tmp/b.png]')

    expect(findLandedImagePreviewEchoes([sourceA], [entry])).toEqual([])
    expect(findLandedImagePreviewEchoes([sourceA, sourceB], [entry])).toEqual([])
    expect(
      findLandedImagePreviewEchoes(
        [sourceA, sourceB, userText('prompt', '[Image #1] [Image #2]')],
        [entry]
      )
    ).toEqual([
      {
        pendingId: 'pending',
        messageId: 'prompt',
        images: ['file:///a.jpg', 'file:///b.jpg']
      }
    ])
  })

  it('moves an early standalone preview to the later folded prompt id', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', '[Image #1]')
    ]

    expect(migrateImagePreviewMessageIds(previous, sessionKey, messages)).toEqual({
      [sessionKey]: { prompt: ['file:///a.jpg'] }
    })
  })

  it('moves an early standalone preview to a trailing-marker prompt id', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look[Image #1]')
    ]

    expect(migrateImagePreviewMessageIds(previous, sessionKey, messages)).toEqual({
      [sessionKey]: { prompt: ['file:///a.jpg'] }
    })
  })

  it('moves a preview when the prompt marker is in a later text block', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const prompt: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'text', text: '[Image #1] here' }
      ]
    }

    expect(
      migrateImagePreviewMessageIds(previous, sessionKey, [
        userText('source', '[Image: source: /tmp/a.png]'),
        prompt
      ])
    ).toEqual({ [sessionKey]: { prompt: ['file:///a.jpg'] } })
  })
})

it('reconciles repeated captions after the send baseline when older history is absent', () => {
  const entry = {
    ...pending('pending', ['file:///a.jpg'], 3),
    text: 'See this',
    baselineTailMessageId: 'tail'
  }
  expect(
    findLandedImagePreviewEchoes(
      [userText('tail', 'earlier'), userText('landed', 'See this[Image #1]')],
      [entry]
    )
  ).toEqual([{ pendingId: 'pending', messageId: 'landed', images: ['file:///a.jpg'] }])
})
