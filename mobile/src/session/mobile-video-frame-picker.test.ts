import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import { VideoFrameExtractionCancelledError, VideoFrameExtractionError, type VideoFrameExtractionEvent } from './mobile-video-frame-extractor'
// `pickVideoFrames`'s real default wiring (`mobile-video-frame-player.ts`,
// which reaches expo-video / expo-image-manipulator) is behind a dynamic
// `import()`, reached only if a test's own `extract` were omitted — every
// test here supplies one, so that import is never reached and the module
// mocked at the boundary below stands in only as a defensive belt.
vi.mock('./mobile-video-frame-player', () => ({
  createNativeVideoFramePlayer: vi.fn(),
  encodeNativeVideoFrame: vi.fn()
}))
import {
  isVideoAsset,
  isVideoOverUploadCap,
  pickVideoFrames,
  resetVideoFrameGroupCounterForTests,
  videoAssetSizeBytes
} from './mobile-video-frame-picker'

describe('isVideoAsset', () => {
  it('recognizes a video by its declared MIME type', () => {
    expect(isVideoAsset({ mimeType: 'video/mp4', uri: 'file:///a' })).toBe(true)
  })

  it('recognizes a video by extension when the picker gave no MIME type', () => {
    expect(isVideoAsset({ uri: 'file:///cache/Screen_Recording.MOV' })).toBe(true)
  })

  it('does not mistake an image or a document for a video', () => {
    expect(isVideoAsset({ mimeType: 'image/jpeg', uri: 'file:///a.jpg' })).toBe(false)
    expect(isVideoAsset({ uri: 'file:///report.pdf' })).toBe(false)
  })
})

describe('isVideoOverUploadCap', () => {
  it('is at (not over) the cap exactly on the line — today\'s behavior is unchanged there', () => {
    expect(isVideoOverUploadCap(CLIPBOARD_IMAGE_MAX_SOURCE_BYTES)).toBe(false)
  })

  it('is just under the cap', () => {
    expect(isVideoOverUploadCap(CLIPBOARD_IMAGE_MAX_SOURCE_BYTES - 1)).toBe(false)
  })

  it('is just over the cap', () => {
    expect(isVideoOverUploadCap(CLIPBOARD_IMAGE_MAX_SOURCE_BYTES + 1)).toBe(true)
  })

  it('is NOT treated as over the cap when the size is unknown (2026-09-27 review)', () => {
    // Routing an unknown size to frame extraction used to be the defensive
    // choice; the review pointed out the ordinary whole-file path already
    // refuses a video that turns out too large, by its own bounded, chunked
    // size check — never by loading the whole file — so there was no
    // memory-safety reason to treat "unknown" as "assume the worst" here.
    expect(isVideoOverUploadCap(null)).toBe(false)
  })
})

describe('videoAssetSizeBytes', () => {
  it('prefers the document picker\'s own declared size over a file stat', () => {
    const createFile = vi.fn(() => ({ size: 999 }))
    expect(videoAssetSizeBytes({ size: 42, uri: 'file:///a' }, createFile as never)).toBe(42)
    expect(createFile).not.toHaveBeenCalled()
  })

  it('falls back to a file stat — never a content read — when the size is not declared', () => {
    const createFile = vi.fn(() => ({ size: 123 }))
    expect(videoAssetSizeBytes({ uri: 'file:///a' }, createFile as never)).toBe(123)
    expect(createFile).toHaveBeenCalledWith('file:///a')
  })

  it('is null, not a guess, when neither source can say', () => {
    const createFile = vi.fn(() => ({ size: null }))
    expect(videoAssetSizeBytes({ uri: 'file:///a' }, createFile as never)).toBeNull()
  })

  it('is null when the stat itself throws, rather than propagating', () => {
    const createFile = vi.fn(() => {
      throw new Error('no such file')
    })
    expect(videoAssetSizeBytes({ uri: 'file:///gone' }, createFile as never)).toBeNull()
  })
})

describe('pickVideoFrames', () => {
  afterEach(() => {
    resetVideoFrameGroupCounterForTests()
    vi.restoreAllMocks()
  })

  /** A fake `extract`: meta first (134 s / 20 frames, the worked example),
   *  then `frameCount` frames — the shape `pickVideoFrames` actually consumes. */
  function fakeExtract(frameCount: number, overrides?: Partial<{ durationMs: number; intervalMs: number | null }>) {
    return vi.fn(async function* (): AsyncGenerator<VideoFrameExtractionEvent> {
      yield {
        kind: 'meta',
        total: frameCount,
        durationMs: overrides?.durationMs ?? 134_000,
        intervalMs: 'intervalMs' in (overrides ?? {}) ? (overrides!.intervalMs as number | null) : 6700
      }
      for (let i = 0; i < frameCount; i += 1) {
        yield { kind: 'frame', frame: { base64: `f${i + 1}`, previewBase64: `p${i + 1}`, index: i + 1 } }
      }
    })
  }

  async function collect(iterable: AsyncGenerator<{ base64: string; uri?: string; videoFrame?: unknown }>) {
    const out: { base64: string; uri?: string; videoFrame?: unknown }[] = []
    for await (const item of iterable) {
      out.push(item)
    }
    return out
  }

  it('yields one picked image per frame, each carrying the group\'s metadata', async () => {
    const extract = fakeExtract(3)
    const items = await collect(
      pickVideoFrames(
        { uri: 'file:///Screen_Recording.mp4', name: 'Screen_Recording.mp4' },
        142 * 1024 * 1024,
        { extract }
      )
    )
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.base64)).toEqual(['f1', 'f2', 'f3'])
    expect(items[0]!.videoFrame).toMatchObject({
      index: 1,
      total: 3,
      sourceName: 'Screen_Recording.mp4',
      durationLabel: '2 min 14 s',
      intervalLabel: 'every 6.7 s',
      sourceSizeLabel: '142 MB'
    })
    // Every frame from the same pick shares one group id.
    const groupIds = new Set(items.map((item) => (item.videoFrame as { groupId: string }).groupId))
    expect(groupIds.size).toBe(1)
  })

  it('carries the small preview, not the full upload-quality bytes, as the picked image\'s uri', () => {
    return collect(pickVideoFrames({ uri: 'file:///clip.mp4' }, 1000, { extract: fakeExtract(1) })).then(
      (items) => {
        expect(items[0]!.uri).toBe('data:image/jpeg;base64,p1')
        expect(items[0]!.base64).toBe('f1')
      }
    )
  })

  it('yields a frame the instant it arrives — a slow later frame does not hold up an earlier one', async () => {
    const seen: string[] = []
    const secondFrame = Promise.withResolvers<void>()
    const extract = vi.fn(async function* (): AsyncGenerator<VideoFrameExtractionEvent> {
      yield { kind: 'meta', total: 2, durationMs: 2000, intervalMs: 1000 }
      yield { kind: 'frame', frame: { base64: 'f1', previewBase64: 'p1', index: 1 } }
      await secondFrame.promise
      yield { kind: 'frame', frame: { base64: 'f2', previewBase64: 'p2', index: 2 } }
    })
    const generator = pickVideoFrames({ uri: 'file:///clip.mp4' }, 1000, { extract })
    const first = await generator.next()
    seen.push((first.value as { base64: string }).base64)
    expect(seen).toEqual(['f1'])
    secondFrame.resolve()
    const second = await generator.next()
    seen.push((second.value as { base64: string }).base64)
    expect(seen).toEqual(['f1', 'f2'])
  })

  it('names the source from the URI when the picker gave no name', async () => {
    const items = await collect(pickVideoFrames({ uri: 'file:///cache/clip-42.mov' }, 1000, { extract: fakeExtract(1) }))
    expect(items[0]!.videoFrame).toMatchObject({ sourceName: 'clip-42.mov' })
  })

  it('omits the cadence clause for a single-frame group rather than saying "every null s"', async () => {
    const items = await collect(
      pickVideoFrames({ uri: 'file:///a.mp4' }, 1000, { extract: fakeExtract(1, { intervalMs: null }) })
    )
    expect(items[0]!.videoFrame).toMatchObject({ intervalLabel: null })
  })

  it('gives two different picks two different group ids', async () => {
    const first = await collect(pickVideoFrames({ uri: 'file:///a.mp4' }, 1000, { extract: fakeExtract(1) }))
    const second = await collect(pickVideoFrames({ uri: 'file:///b.mp4' }, 1000, { extract: fakeExtract(1) }))
    expect((first[0]!.videoFrame as { groupId: string }).groupId).not.toBe(
      (second[0]!.videoFrame as { groupId: string }).groupId
    )
  })

  it('propagates a cancellation as-is, without relabeling it a generic failure', async () => {
    const extract = vi.fn(async function* (): AsyncGenerator<VideoFrameExtractionEvent> {
      yield { kind: 'meta', total: 1, durationMs: 1000, intervalMs: null }
      throw new VideoFrameExtractionCancelledError()
    })
    await expect(collect(pickVideoFrames({ uri: 'file:///a.mp4' }, 1000, { extract }))).rejects.toBeInstanceOf(
      VideoFrameExtractionCancelledError
    )
  })

  it('wraps any other extraction failure as VideoFrameExtractionError, reason intact', async () => {
    const extract = vi.fn(async function* (): AsyncGenerator<VideoFrameExtractionEvent> {
      yield { kind: 'meta', total: 1, durationMs: 1000, intervalMs: null }
      throw new Error('Unsupported codec')
    })
    await expect(collect(pickVideoFrames({ uri: 'file:///a.mp4' }, 1000, { extract }))).rejects.toThrow(
      'Unsupported codec'
    )
  })

  it('keeps already-yielded frames intact when a later one fails — a partial read is not a total loss', async () => {
    const extract = vi.fn(async function* (): AsyncGenerator<VideoFrameExtractionEvent> {
      yield { kind: 'meta', total: 3, durationMs: 3000, intervalMs: 1000 }
      yield { kind: 'frame', frame: { base64: 'f1', previewBase64: 'p1', index: 1 } }
      throw new Error('device ran out of memory')
    })
    const generator = pickVideoFrames({ uri: 'file:///a.mp4' }, 1000, { extract })
    const first = await generator.next()
    expect(first.done).toBe(false)
    expect((first.value as { base64: string }).base64).toBe('f1')
    await expect(generator.next()).rejects.toBeInstanceOf(VideoFrameExtractionError)
  })
})
