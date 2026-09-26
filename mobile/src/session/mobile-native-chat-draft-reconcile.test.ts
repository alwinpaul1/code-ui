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

// 2026-09-26, Claude Code 2.1.283: a photo sent with no words before the
// chat's read settled took the first photo row after whatever the phone had
// on screen, an older message's. A row older than the newest by more than the
// time since the send was written before it; a row already drawing another
// send's photos is that send's, unless words show two sends glued into it.
describe('the phone’s photos, kept off rows that are not their send’s', () => {
  const sentAt = Date.parse('2026-09-26T09:30:03.500Z')
  const now = sentAt + 1_000
  const stamped = (row: NativeChatMessage, clock: string): NativeChatMessage => ({
    ...row,
    timestamp: Date.parse(`2026-09-26T${clock}Z`)
  })
  const photoRow = (id: string, clock: string) => stamped(userText(id, '[Image #17]'), clock)
  const reply = (clock: string): NativeChatMessage => ({
    ...stamped(userText('reply', 'Looked.'), clock),
    role: 'assistant'
  })
  const unsettled = { ...pending('pending', ['file:///p17.jpg']), sentAt, sentBeforeReadSettled: true }
  const ids = (landed: { messageId: string }[]) => landed.map((item) => item.messageId)

  it('binds a photo sent before the read settled to the row written after it, not an older one', () => {
    const messages = [photoRow('older', '08:43:47.644'), photoRow('mine', '09:30:03.923')]
    expect(findLandedImagePreviewEchoes(messages, [unsettled], {}, now)).toEqual([
      { pendingId: 'pending', messageId: 'mine', images: ['file:///p17.jpg'] }
    ])
  })

  it('binds nothing while the only photo row is older than the send and its own has not landed', () => {
    const messages = [photoRow('older', '09:29:03.000'), reply('09:30:04.000')]
    expect(findLandedImagePreviewEchoes(messages, [unsettled], {}, now)).toEqual([])
  })

  // Review, 2026-09-26: comparing the send's time with the row's stamp
  // refused the send's own row when the phone's clock ran more than a minute
  // ahead, and a photo with no words retires only by binding, so its bubble
  // stood beside a chip for good. Two spans on one clock each need no setting.
  it('binds its own row however far ahead the phone’s clock runs', () => {
    const ahead = { ...unsettled, sentAt: sentAt + 90_000 }
    const messages = [photoRow('older', '08:43:47.644'), photoRow('mine', '09:30:03.923')]
    expect(ids(findLandedImagePreviewEchoes(messages, [ahead], {}, now + 90_000))).toEqual(['mine'])
  })

  it('keeps a photo with words off an older row with the same words, and binds its own', () => {
    const captioned = { ...unsettled, text: 'look at this' }
    const older = stamped(userText('older', '[Image #16] look at this'), '08:43:47.644')
    const mine = stamped(userText('mine', '[Image #17] look at this'), '09:30:03.923')
    expect(ids(findLandedImagePreviewEchoes([older, mine], [captioned], {}, now))).toEqual(['mine'])
    // A send made against a settled read is matched by its words alone.
    const settled = { ...pending('pending', ['file:///p17.jpg']), text: 'look at this', sentAt }
    expect(ids(findLandedImagePreviewEchoes([older, reply('09:30:04.000')], [settled], {}, now))).toEqual(['older'])
  })

  it('binds as before a send from an older build, which kept no send time', () => {
    const messages = [photoRow('older', '08:43:47.644')]
    expect(ids(findLandedImagePreviewEchoes(messages, [pending('pending', ['file:///p17.jpg'])]))).toEqual(['older'])
  })

  it('leaves a row already drawing another send’s photos to that send', () => {
    const messages = [photoRow('first', '09:29:31.000'), photoRow('mine', '09:30:03.923')]
    expect(ids(findLandedImagePreviewEchoes(messages, [unsettled], { first: ['file:///p16.jpg'] }, now))).toEqual(['mine'])
  })

  // Review, 2026-09-26: a row naming more photos than its send had keeps
  // room, and the next photo with no words went into it, not to its own row.
  it('keeps a photo with no words off a row that already draws another send’s photo, with room or not', () => {
    const roomy = stamped(userText('first', '[Image #1] [Image #2]'), '09:30:04.000')
    const messages = [roomy, photoRow('mine', '09:30:09.000')]
    const second = { ...pending('second', ['file:///two.jpg']), sentAt }
    expect(ids(findLandedImagePreviewEchoes(messages, [second], { first: ['file:///one.jpg'] }, now))).toEqual(['mine'])
  })

  // The ordinal a photo with no words was sent with counts the photo sends
  // still waiting then; once the first has retired onto its row, counting that
  // row again sent the second nowhere.
  it('binds the second of two photos sent with no words to its own row after the first retired', () => {
    const messages = [photoRow('one', '09:30:04.000'), photoRow('two', '09:30:09.000')]
    const second = { ...pending('second', ['file:///two.jpg'], 2), sentAt }
    expect(ids(findLandedImagePreviewEchoes(messages, [second], { one: ['file:///one.jpg'] }, now))).toEqual(['two'])
  })

  // Review, 2026-09-26: two photo sends glued on the agent's input line land
  // as one row. The first binds it; the second was refused a row that
  // already drew a photo, and its bubble never left.
  it('puts a second send’s photo after the first’s on a row both were glued into', () => {
    const glued = stamped(userText('g1', '[Image #1] look at this [Image #2] and this one'), '09:30:05.000')
    const second = { ...pending('second', ['file:///b.jpg']), text: 'and this one', sentAt }
    expect(findLandedImagePreviewEchoes([glued], [second], { g1: ['file:///a.jpg'] }, now)).toEqual([
      { pendingId: 'second', messageId: 'g1', images: ['file:///a.jpg', 'file:///b.jpg'] }
    ])
    // Both in one pass, in send order.
    const first = { ...pending('first', ['file:///a.jpg']), text: 'look at this', sentAt }
    expect(findLandedImagePreviewEchoes([glued], [first, second], {}, now).map((item) => item.images)).toEqual([
      ['file:///a.jpg'],
      ['file:///a.jpg', 'file:///b.jpg']
    ])
  })
})

// The companion Claude Code writes beside a photo row names the path the
// phone pasted (2.1.283, the Thesis session: `[Image: source:
// /var/folders/…/T/orca-paste-1790415003275-839747e3-….png]`), and Codex's
// row carries it as an image block. A send that kept its pasted paths binds
// by them.
describe('the phone’s photos, bound by the paths it pasted', () => {
  const TEMP = '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T'
  const pastePath = (stamp: number, uuid: string) => `${TEMP}/orca-paste-${stamp}-${uuid}.png`
  const MINE = pastePath(1790415003275, '839747e3-c083-46eb-b11e-4ea29a8da649')
  const MINE_TOO = pastePath(1790415003611, '5211776c-2f4a-4164-b0e1-6c2a8f1d9e07')
  const OLDER = pastePath(1790414998000, '42c80aee-6038-4de8-a1b2-0c3d4e5f6a7b')
  // The prompt row, then its companion, as Claude Code 2.1.283 writes them.
  const rowsOf = (id: string, paths: string[], text = ''): NativeChatMessage[] => [
    userText(id, `${paths.map((_, index) => `[Image #${index + 1}]`).join(' ')} ${text}`.trim()),
    {
      id: `${id}-companion`,
      role: 'user',
      blocks: paths.map((path) => ({ type: 'text' as const, text: `[Image: source: ${path}]` })),
      timestamp: null,
      source: 'transcript'
    }
  ]
  const sent = (id: string, images: string[], imagePaths?: string[], text = ''): PendingImagePreviewEcho => ({
    ...pending(id, images),
    text,
    ...(imagePaths ? { imagePaths } : {})
  })

  it('binds a photo with no words to the row naming its path, not an older photo row before it', () => {
    const messages = [...rowsOf('older', [OLDER]), ...rowsOf('mine', [MINE])]
    expect(findLandedImagePreviewEchoes(messages, [sent('p', ['file:///p17.jpg'], [MINE])])).toEqual([
      { pendingId: 'p', messageId: 'mine', images: ['file:///p17.jpg'] }
    ])
  })

  it('binds nothing while the only photo rows name other paths', () => {
    expect(findLandedImagePreviewEchoes(rowsOf('older', [OLDER]), [sent('p', ['file:///p17.jpg'], [MINE])])).toEqual([])
  })

  it('draws each photo on the block that names it, and leaves a block naming another path the desktop’s', () => {
    // A stale paste left on the input line went out with the send: the row
    // names three photos, two of them the phone's.
    const messages = rowsOf('mine', [OLDER, MINE_TOO, MINE], 'see these')
    const send = sent('p', ['file:///a.jpg', 'file:///b.jpg'], [MINE, MINE_TOO], 'see these')
    expect(findLandedImagePreviewEchoes(messages, [send])).toEqual([
      { pendingId: 'p', messageId: 'mine', images: ['', 'file:///b.jpg', 'file:///a.jpg'] }
    ])
  })

  it('puts two sends glued into one row each on its own block', () => {
    const messages = rowsOf('glued', [MINE, MINE_TOO], 'look at this and this one')
    const first = sent('first', ['file:///a.jpg'], [MINE], 'look at this')
    const second = sent('second', ['file:///b.jpg'], [MINE_TOO], 'and this one')
    expect(findLandedImagePreviewEchoes(messages, [first, second]).map((item) => item.images)).toEqual([
      ['file:///a.jpg', ''],
      ['file:///a.jpg', 'file:///b.jpg']
    ])
  })

  it('matches a path the phone got back under /private', () => {
    const send = sent('p', ['file:///p17.jpg'], [`/private${MINE}`])
    expect(findLandedImagePreviewEchoes(rowsOf('mine', [MINE]), [send]).map((item) => item.messageId)).toEqual(['mine'])
  })

  // Claude Code writes the companion after the prompt, so a read can hold the
  // prompt alone. Waiting for it there let the send retire by its words while
  // its photos did not bind, and the row drew "Image on Desktop".
  it('binds its own prompt row by the old rules before the companion lands, past an older row naming another path', () => {
    const messages = [...rowsOf('older', [OLDER]), userText('mine', '[Image #1]')]
    expect(findLandedImagePreviewEchoes(messages, [sent('p', ['file:///p17.jpg'], [MINE])]).map((item) => item.messageId)).toEqual([
      'mine'
    ])
  })

  it('binds by the old rules where the rows name no photo, as on a host that writes no companion', () => {
    const bare = userText('mine', '[Image #1]')
    expect(findLandedImagePreviewEchoes([bare], [sent('p', ['file:///p17.jpg'], [MINE])]).map((item) => item.messageId)).toEqual([
      'mine'
    ])
  })

  it.each([
    ['kept no paths', undefined],
    ['kept paths that do not pair with its photos', [MINE, MINE_TOO]],
    ['kept an empty path', ['']]
  ])('binds by the old rules a send that %s', (_, imagePaths) => {
    const messages = [...rowsOf('first', [OLDER]), ...rowsOf('mine', [MINE])]
    expect(findLandedImagePreviewEchoes(messages, [sent('p', ['file:///p17.jpg'], imagePaths)]).map((item) => item.messageId)).toEqual([
      'first'
    ])
  })

  it('binds nothing for an empty transcript, and nothing for a send with no photo', () => {
    expect(findLandedImagePreviewEchoes([], [sent('p', ['file:///p17.jpg'], [MINE])])).toEqual([])
    expect(findLandedImagePreviewEchoes(rowsOf('mine', [MINE]), [sent('p', [], [])])).toEqual([])
  })
})

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


  it('does not hand a second photo to the turn the first one already landed in', () => {
    // The baseline is the newest row that existed when this photo was sent. On
    // Claude Code 2.1.263 that row is the "[Image: source: …]" companion the
    // agent writes AFTER the prompt, and normalization folds it away — so the
    // baseline id was absent from the index, both "after the baseline" guards
    // went off, and the echo bound to the older photo's own turn. Photo A's
    // bubble then showed photo B, and photo B's showed nothing.
    const messages = [
      userText('m1', 'hello'),
      userText('P', '[Image #1] look at this'),
      userText('S', '[Image: source: /var/folders/0y/T/orca-paste-1788707946740-a.png]')
    ]
    expect(
      findLandedImagePreviewEchoes(messages, [
        {
          id: 'pending-2',
          text: '',
          images: ['file:///phone/second.jpg'],
          expectedOccurrence: 1,
          baselineTailMessageId: 'S'
        }
      ])
    ).toEqual([])
  })

  it('still binds a photo that landed after its folded-away baseline', () => {
    const messages = [
      userText('P', '[Image #1] look at this'),
      userText('S', '[Image: source: /var/folders/0y/T/orca-paste-1788707946740-a.png]'),
      userText('P2', '[Image #1] and this one')
    ]
    expect(
      findLandedImagePreviewEchoes(messages, [
        {
          id: 'pending-2',
          text: 'and this one',
          images: ['file:///phone/second.jpg'],
          expectedOccurrence: 1,
          baselineTailMessageId: 'S'
        }
      ])
    ).toEqual([{ pendingId: 'pending-2', messageId: 'P2', images: ['file:///phone/second.jpg'] }])
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
