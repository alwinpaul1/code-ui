import { describe, expect, it } from 'vitest'
import {
  buildMobileNativeChatFileNotes,
  isPendingNativeChatFile,
  stripMobileNativeChatFileNotes,
  withMobileNativeChatFileNotes
} from './mobile-native-chat-file-attachment'

const pdf = {
  id: 'f1',
  path: '/tmp/orca-paste-1-abc.png',
  previewUri: 'file:///cache/report.pdf',
  kind: 'file' as const,
  name: 'report.pdf'
}
const image = { id: 'i1', path: '/tmp/orca-paste-2-def.png', previewUri: 'file:///cache/a.jpg' }

describe('mobile native chat file attachments', () => {
  it('tells images and files apart', () => {
    expect(isPendingNativeChatFile(pdf)).toBe(true)
    expect(isPendingNativeChatFile(image)).toBe(false)
  })

  it('names the file, its host path, and the rename the agent must do', () => {
    expect(buildMobileNativeChatFileNotes([pdf, image])).toBe(
      'Attached file "report.pdf" is on this machine at /tmp/orca-paste-1-abc.png. ' +
        'The .png extension is only the upload container; move it to a path ending in ".pdf" before reading it.'
    )
  })

  it('prepends the notes to the text and sends a bare file alone', () => {
    expect(withMobileNativeChatFileNotes('summarize this', [pdf])).toBe(
      `${buildMobileNativeChatFileNotes([pdf])}\n\nsummarize this`
    )
    expect(withMobileNativeChatFileNotes('   ', [pdf])).toBe(buildMobileNativeChatFileNotes([pdf]))
    expect(withMobileNativeChatFileNotes('hi', [image])).toBe('hi')
  })

  // 2026-09-13: a screen recording sent with a sentence left the sentence in
  // the composer, because the draft clear compared the note-led body to it.
  it('gives back the typed text out of a sent body led by file notes', () => {
    const body = withMobileNativeChatFileNotes('When a keyboard is open\nthe scroll is odd', [pdf])
    expect(stripMobileNativeChatFileNotes(body)).toBe('When a keyboard is open\nthe scroll is odd')
    expect(stripMobileNativeChatFileNotes(withMobileNativeChatFileNotes('', [pdf]))).toBe('')
    expect(stripMobileNativeChatFileNotes('plain text')).toBe('plain text')
    expect(stripMobileNativeChatFileNotes('Attached file "x" I mention in passing\n\nok')).toBe(
      'Attached file "x" I mention in passing\n\nok'
    )
  })
})
