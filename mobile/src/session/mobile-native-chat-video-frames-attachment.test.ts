import { describe, expect, it } from 'vitest'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { withMobileNativeChatFileNotes } from './mobile-native-chat-file-attachment'
import {
  buildMobileNativeChatVideoFrameNotes,
  isPendingNativeChatVideoFrame,
  stripMobileNativeChatAttachmentNotes,
  stripMobileNativeChatVideoFrameNotes,
  withMobileNativeChatAttachmentNotes,
  withMobileNativeChatVideoFrameNotes
} from './mobile-native-chat-video-frames-attachment'

function frame(index: number, total: number): PendingNativeChatImage {
  return {
    id: `img-${index}`,
    path: `/tmp/frame-${index}.png`,
    previewUri: `data:image/jpeg;base64,f${index}`,
    videoFrame: {
      groupId: 'g1',
      index,
      total,
      sourceName: 'Screen_Recording_2026-09-27.mp4',
      durationLabel: '2 min 14 s',
      intervalLabel: 'every 6.7 s',
      sourceSizeLabel: '142 MB'
    }
  }
}

const pdf: PendingNativeChatImage = {
  id: 'f1',
  path: '/tmp/a.png',
  previewUri: 'file:///cache/report.pdf',
  kind: 'file',
  name: 'report.pdf'
}
const plainImage: PendingNativeChatImage = { id: 'i1', path: '/tmp/b.png', previewUri: 'file:///cache/a.jpg' }

describe('isPendingNativeChatVideoFrame', () => {
  it('tells a video frame apart from a plain image and a file', () => {
    expect(isPendingNativeChatVideoFrame(frame(1, 20))).toBe(true)
    expect(isPendingNativeChatVideoFrame(plainImage)).toBe(false)
    expect(isPendingNativeChatVideoFrame(pdf)).toBe(false)
  })
})

describe('buildMobileNativeChatVideoFrameNotes', () => {
  it('states the video, its duration, the frame count and the cadence, exactly as decided', () => {
    expect(buildMobileNativeChatVideoFrameNotes([frame(1, 20), frame(2, 20)])).toBe(
      'Frames from Screen_Recording_2026-09-27.mp4 (2 min 14 s, 20 frames, every 6.7 s). ' +
        'The video itself is 142 MB, over the 18 MB the desktop accepts, so it was not sent.'
    )
  })

  it('says "frame" in the singular for a one-frame group', () => {
    expect(buildMobileNativeChatVideoFrameNotes([frame(1, 1)])).toContain('1 frame,')
    expect(buildMobileNativeChatVideoFrameNotes([frame(1, 1)])).not.toContain('1 frames,')
  })

  it('writes one line per distinct video, not one per frame', () => {
    const second: PendingNativeChatImage = {
      ...frame(1, 1),
      id: 'img-second',
      videoFrame: { ...frame(1, 1).videoFrame!, groupId: 'g2', sourceName: 'clip-2.mp4' }
    }
    const notes = buildMobileNativeChatVideoFrameNotes([frame(1, 20), frame(2, 20), second])
    expect(notes.split('\n')).toHaveLength(2)
    expect(notes).toContain('Screen_Recording_2026-09-27.mp4')
    expect(notes).toContain('clip-2.mp4')
  })

  it('is empty with no video frames at all, plain images included', () => {
    expect(buildMobileNativeChatVideoFrameNotes([plainImage, pdf])).toBe('')
  })
})

describe('withMobileNativeChatVideoFrameNotes / stripMobileNativeChatVideoFrameNotes', () => {
  it('prepends the note and a bare group still sends', () => {
    expect(withMobileNativeChatVideoFrameNotes('describe this', [frame(1, 1)])).toBe(
      `${buildMobileNativeChatVideoFrameNotes([frame(1, 1)])}\n\ndescribe this`
    )
    expect(withMobileNativeChatVideoFrameNotes('   ', [frame(1, 1)])).toBe(
      buildMobileNativeChatVideoFrameNotes([frame(1, 1)])
    )
    expect(withMobileNativeChatVideoFrameNotes('hi', [plainImage])).toBe('hi')
  })

  it('gives back the typed text out of a sent body led by a frame note', () => {
    const body = withMobileNativeChatVideoFrameNotes('what happened here?', [frame(1, 20)])
    expect(stripMobileNativeChatVideoFrameNotes(body)).toBe('what happened here?')
  })

  it('leaves plain text, and a line that merely mentions "Frames from" without the note\'s tail, alone', () => {
    expect(stripMobileNativeChatVideoFrameNotes('plain text')).toBe('plain text')
    expect(stripMobileNativeChatVideoFrameNotes('Frames from my trip last year\n\nlook at these')).toBe(
      'Frames from my trip last year\n\nlook at these'
    )
  })
})

describe('withMobileNativeChatAttachmentNotes / stripMobileNativeChatAttachmentNotes', () => {
  it('reads frames, then the file note, then the user\'s text, for a mixed send', () => {
    const text = withMobileNativeChatAttachmentNotes('take a look', [frame(1, 1), pdf])
    const lines = text.split('\n\n')
    expect(lines[0]).toBe(buildMobileNativeChatVideoFrameNotes([frame(1, 1)]))
    expect(lines[1]).toContain('Attached file "report.pdf"')
    expect(lines[2]).toBe('take a look')
  })

  it('round-trips through both notes back to the user\'s own text', () => {
    const text = withMobileNativeChatAttachmentNotes('take a look', [frame(1, 1), pdf])
    expect(stripMobileNativeChatAttachmentNotes(text)).toBe('take a look')
  })

  it('is unaffected by files alone, matching the plain file-note behavior', () => {
    expect(withMobileNativeChatAttachmentNotes('hi', [pdf])).toBe(withMobileNativeChatFileNotes('hi', [pdf]))
  })
})
