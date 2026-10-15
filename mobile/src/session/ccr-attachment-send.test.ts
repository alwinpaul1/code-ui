import { describe, expect, it } from 'vitest'
import {
  CCR_ATTACHMENT_FAILED,
  CCR_ATTACHMENT_ON_DESKTOP,
  CCR_ATTACHMENT_OTHER_ACCOUNT,
  CCR_WAITING_FOR_UPLOADS,
  chipsHeldByAnthropic,
  planCcrAttachmentSend
} from './ccr-attachment-send'
import { buildCcrUserEventBody } from './ccr-send'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

const ACCOUNT = 'acct-tab'
const photo = (id: string, extra: Partial<PendingNativeChatImage> = {}): PendingNativeChatImage => ({
  id,
  path: '',
  previewUri: `file:///cache/${id}.jpg`,
  anthropicFile: { fileId: `file_${id}`, fileName: 'image.jpg', isImage: true, accountId: ACCOUNT },
  ...extra
})
const doc = (id: string): PendingNativeChatImage => ({
  id,
  path: '',
  previewUri: `file:///cache/${id}.pdf`,
  kind: 'file',
  name: 'report.pdf',
  anthropicFile: { fileId: `file_${id}`, fileName: 'report.pdf', isImage: false, accountId: ACCOUNT }
})

describe('which chips one Anthropic send references (only finished uploads, as the Claude app does)', () => {
  it('sends the words alone with zero attachments, and nothing at all with no words either', () => {
    expect(planCcrAttachmentSend([], 'hello', ACCOUNT)).toEqual({ kind: 'send', files: [], sent: [], previewUris: [] })
    expect(planCcrAttachmentSend([], '   ', ACCOUNT)).toEqual({ kind: 'nothing' })
  })

  it('references one finished photo with the words, and sends a bare attachment with no words', () => {
    const plan = planCcrAttachmentSend([photo('a')], 'what is this', ACCOUNT)
    expect(plan).toEqual({ kind: 'send', files: [{ file_uuid: 'file_a', file_name: 'image.jpg', is_image: true }], sent: [photo('a')], previewUris: ['file:///cache/a.jpg'] })
    expect(planCcrAttachmentSend([doc('d')], '', ACCOUNT)).toMatchObject({ kind: 'send', files: [{ file_uuid: 'file_d', file_name: 'report.pdf', is_image: false }], previewUris: [] })
  })

  it('puts the files and the words in ONE user event, file_attachments beside the plain-string content', () => {
    const plan = planCcrAttachmentSend([photo('a'), doc('d')], 'look', ACCOUNT)
    if (plan.kind !== 'send') throw new Error('expected a send')
    const body = buildCcrUserEventBody({ sessionId: 'session_01ABC', uuid: 'u-1', text: 'look', fileAttachments: plan.files })
    expect(body).toEqual({
      session_id: 'cse_01ABC',
      events: [{ payload: { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'look' }, file_attachments: [
        { file_uuid: 'file_a', file_name: 'image.jpg', is_image: true },
        { file_uuid: 'file_d', file_name: 'report.pdf', is_image: false }
      ] } }]
    })
  })

  it('leaves file_attachments out of a send with no attachment', () => {
    const body = buildCcrUserEventBody({ sessionId: 'cse_01ABC', uuid: 'u-1', text: 'hi', fileAttachments: [] })
    expect(body.events[0]!.payload).not.toHaveProperty('file_attachments')
  })

  it('never sends a failed upload: the send is held, as the app disables Send beside a failed chip', () => {
    const failed = photo('f', { failed: true, anthropicFile: undefined })
    expect(planCcrAttachmentSend([photo('a'), failed], 'hi', ACCOUNT)).toEqual({ kind: 'refuse', message: CCR_ATTACHMENT_FAILED })
    expect(planCcrAttachmentSend([failed], '', ACCOUNT)).toEqual({ kind: 'refuse', message: CCR_ATTACHMENT_FAILED })
  })

  it('holds the send while a chip is still uploading rather than dropping it', () => {
    expect(planCcrAttachmentSend([photo('a'), photo('u', { uploading: true, anthropicFile: undefined })], 'hi', ACCOUNT)).toEqual({ kind: 'refuse', message: CCR_WAITING_FOR_UPLOADS })
  })

  it('does not reference a chip the user removed', () => {
    const strip = [photo('a'), photo('b')]
    const afterRemove = strip.filter((chip) => chip.id !== 'a')
    const plan = planCcrAttachmentSend(afterRemove, 'hi', ACCOUNT)
    expect(plan).toMatchObject({ kind: 'send', files: [{ file_uuid: 'file_b' }] })
  })

  it('refuses a chip uploaded under another account than the tab session, never posting it', () => {
    const other = photo('o', { anthropicFile: { fileId: 'file_o', fileName: 'image.jpg', isImage: true, accountId: 'acct-other-copy' } })
    expect(planCcrAttachmentSend([other], 'hi', ACCOUNT)).toEqual({ kind: 'refuse', message: CCR_ATTACHMENT_OTHER_ACCOUNT })
  })

  it('refuses a chip whose bytes went to the desktop: there is no Anthropic file to reference', () => {
    const desktop: PendingNativeChatImage = { id: 'h', path: '/tmp/orca-clip-1.png', previewUri: 'file:///h.jpg' }
    expect(planCcrAttachmentSend([desktop], 'hi', ACCOUNT)).toEqual({ kind: 'refuse', message: CCR_ATTACHMENT_ON_DESKTOP })
    expect(chipsHeldByAnthropic([desktop])).toBe(false)
    expect(chipsHeldByAnthropic([desktop, photo('a')])).toBe(true)
  })
})
