import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { ccrKeptImages, decodeCcrEvent, decodeCcrEvents, slimCcrEvent } from './ccr-transcript-decode'
import { takeUserUploads } from './mobile-native-chat-file-mentions'
import { PNG_1PX } from './fixtures/ccr-session-api-2026-10-14'
import { FILES_ONLY_PROMPT, RECORDING_PROMPT, RECORDING_UUID, SHEET_CALL_ID, readSheetEvents, withPayload } from './fixtures/ccr-attachments-2026-10-15'

// The user's report of 2026-10-15: the Claude app drew the recording they attached to a prompt as a
// card ("MP4", "Screen_Recording_20261015_123030_Code UI") and the contact sheet Claude Read as a
// picture; Code UI drew neither, because `file_attachments` sits NEXT to the message in the event
// (payload.file_attachments, not message.content) and nothing read it. Shapes: the recorded events in
// fixtures/ccr-attachments-2026-10-15.ts. What the app draws: scratchpad/plan/claude-transcript-
// inventory.md and mobile-native-chat-file-card-styles.ts (m330.java:6263-6420, f0f.java, p530.java:100-148).

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`

function uploadsOf(blocks: readonly NativeChatBlock[]) {
  return takeUserUploads(blocks)
}

describe('a prompt’s file_attachments, as the Claude app draws them', () => {
  it('draws the recording as a card above the words, named without its extension and badged MP4', () => {
    const [row] = decodeCcrEvent(RECORDING_PROMPT)
    expect(row).toBeDefined()
    expect(row!.role).toBe('user')
    const { cards, blocks } = uploadsOf(row!.blocks)
    expect(cards).toEqual([
      expect.objectContaining({
        name: 'Screen_Recording_20261015_123030_Code UI',
        ext: 'MP4',
        attachment: { fileUuid: RECORDING_UUID, fileName: 'Screen_Recording_20261015_123030_Code UI.mp4', isImage: false }
      })
    ])
    expect(blocks).toEqual([{ type: 'text', text: "See claude mobile shows nicely and code ui doesn't show fix  that" }])
  })

  it('draws every file of a prompt that was only files: one row, four cards, no words', () => {
    const rows = decodeCcrEvents([FILES_ONLY_PROMPT], new WeakMap())
    expect(rows).toHaveLength(1)
    const { cards, blocks } = uploadsOf(rows[0]!.blocks)
    expect(cards.map((card) => [card.name, card.ext, card.attachment?.isImage])).toEqual([
      ['Screen_Recording_20261014_185614_Claude', 'MP4', false],
      ['1000150278', 'JPG', true],
      ['1000150276', 'JPG', true],
      ['1000150274', 'JPG', true]
    ])
    expect(blocks).toEqual([])
  })

  it('badges a pdf and a png by their own extensions, and a name with no extension with none', () => {
    const event = withPayload(RECORDING_PROMPT, {
      file_attachments: [
        { file_name: 'Quarterly report.pdf', file_uuid: 'f-pdf', is_image: false },
        { file_name: 'shot.png', file_uuid: 'f-png', is_image: true },
        { file_name: 'README', file_uuid: 'f-none', is_image: false }
      ]
    })
    const { cards } = uploadsOf(decodeCcrEvent(event)[0]!.blocks)
    expect(cards.map((card) => [card.name, card.ext])).toEqual([
      ['Quarterly report', 'PDF'],
      ['shot', 'PNG'],
      ['README', '']
    ])
  })

  it('takes the last dot as the extension only when it is one: no space in it, not all digits', () => {
    const names = ['archive.tar.gz', 'notes v1. final', 'version 2.5', 'trailing.']
    const event = withPayload(RECORDING_PROMPT, { file_attachments: names.map((file_name, index) => ({ file_name, file_uuid: `f${index}`, is_image: false })) })
    const { cards } = uploadsOf(decodeCcrEvent(event)[0]!.blocks)
    expect(cards.map((card) => [card.name, card.ext])).toEqual([
      ['archive.tar', 'GZ'],
      ['notes v1. final', ''],
      ['version 2.5', ''],
      ['trailing.', '']
    ])
  })

  it('refuses an entry it does not know the shape of, and draws the rest', () => {
    const event = withPayload(RECORDING_PROMPT, {
      file_attachments: [
        { file_name: 'ok.pdf', file_uuid: 'f-ok', is_image: false },
        { file_name: 'no-id.pdf', is_image: false },
        { file_uuid: 'f-no-name', is_image: false },
        { file_name: 42, file_uuid: 'f-num' },
        'a string',
        null,
        { file_name: 'weird.pdf', file_uuid: 'f-weird', is_image: 'yes' }
      ]
    })
    const { cards } = uploadsOf(decodeCcrEvent(event)[0]!.blocks)
    expect(cards.map((card) => card.attachment?.fileUuid)).toEqual(['f-ok', 'f-weird'])
    expect(cards[1]!.attachment?.isImage).toBe(false)
  })

  it.each([
    ['not a list', 'oops'],
    ['an object', { file_name: 'a.pdf', file_uuid: 'x' }],
    ['null', null],
    ['an empty list', []]
  ])('draws the words as before when file_attachments is %s', (_label, value) => {
    const rows = decodeCcrEvent(withPayload(RECORDING_PROMPT, { file_attachments: value }))
    expect(rows).toHaveLength(1)
    expect(uploadsOf(rows[0]!.blocks).cards).toEqual([])
    expect(rows[0]!.blocks).toEqual([{ type: 'text', text: "See claude mobile shows nicely and code ui doesn't show fix  that" }])
  })

  it('draws no row for an empty prompt with an empty list, as before', () => {
    expect(decodeCcrEvent(withPayload(FILES_ONLY_PROMPT, { file_attachments: [] }))).toEqual([])
  })

  it('does not put the attachment on an assistant event', () => {
    const rows = decodeCcrEvent(withPayload(RECORDING_PROMPT, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }))
    expect(uploadsOf(rows[0]!.blocks).cards).toEqual([])
  })
})

describe('a picture Claude Read, drawn under its tool run', () => {
  it('is kept under the Read’s call id, the key the Read row draws it by', () => {
    const { call, result } = readSheetEvents(PNG_1PX)
    const slim = slimCcrEvent(result, keep)
    expect(ccrKeptImages(slim).tool.get(SHEET_CALL_ID)).toBe(keep(`ccr\0tool\0${SHEET_CALL_ID}`))
    expect(JSON.stringify(slim)).not.toContain(PNG_1PX)
    const rows = decodeCcrEvents([call, slim], new WeakMap())
    expect(rows.map((row) => row.role)).toEqual(['assistant', 'tool'])
    expect(rows[0]!.blocks[0]).toMatchObject({ type: 'tool-call', name: 'Read', callId: SHEET_CALL_ID })
  })
})
