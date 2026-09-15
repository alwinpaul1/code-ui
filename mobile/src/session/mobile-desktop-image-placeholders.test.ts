import { describe, expect, it } from 'vitest'
import { keepDesktopImagePlaceholders } from './mobile-desktop-image-placeholders'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

function user(id: string, text: string, extra: NativeChatMessage['blocks'] = []): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [...extra, { type: 'text', text }],
    timestamp: 0,
    source: 'transcript'
  } as NativeChatMessage
}

// Device screenshot 2026-09-15: "see the host terminal  it had images" — a double
// space where the picture belonged. Orca's normalizer turns `[Image #N]` into a
// real image block when the file is at hand and DELETES it when it is not; on
// the phone the bytes never arrive, so the message read as though nothing had
// been attached. The pending-echo path already said "Image on Desktop"; a prompt
// typed while the agent was idle gets a transcript row instead, and that path
// had nothing.
describe('a landed prompt whose image the phone does not have', () => {
  it('says an image was sent instead of leaving a gap', () => {
    const original = [user('m1', 'see the host terminal [Image #192] it had images')]
    const normalized = [user('m1', 'see the host terminal  it had images')]
    const kept = keepDesktopImagePlaceholders(original, normalized)
    expect(kept[0]!.blocks[0]).toMatchObject({
      text: 'see the host terminal Image on Desktop it had images'
    })
  })

  it('leaves a row alone when the picture itself is there', () => {
    const original = [user('m1', 'look [Image #1]')]
    const normalized = [user('m1', 'look ', [{ type: 'image-ref', url: 'file:///a.png' } as never])]
    expect(keepDesktopImagePlaceholders(original, normalized)[0]).toBe(normalized[0])
  })

  it('leaves a prompt with no image untouched', () => {
    const original = [user('m1', 'just words')]
    const normalized = [user('m1', 'just words')]
    expect(keepDesktopImagePlaceholders(original, normalized)[0]).toBe(normalized[0])
  })

  it('leaves the agent’s own messages alone', () => {
    const assistant = {
      id: 'a1',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'talking about [Image #4]' }],
      timestamp: 0,
      source: 'transcript'
    } as NativeChatMessage
    expect(keepDesktopImagePlaceholders([assistant], [assistant])[0]).toBe(assistant)
  })

  it('reads an empty transcript', () => {
    expect(keepDesktopImagePlaceholders([], [])).toEqual([])
  })

  it('leaves a marker-only turn to the preview path', () => {
    // No text block to write into, and the row may still gain a picture further
    // down the pipeline from a local preview. Adding a placeholder here put one
    // beside that picture.
    const original = [user('m1', '[Image #7]')]
    const normalized: NativeChatMessage[] = [
      { id: 'm1', role: 'user', blocks: [], timestamp: 0, source: 'transcript' } as NativeChatMessage
    ]
    expect(keepDesktopImagePlaceholders(original, normalized)[0]).toBe(normalized[0])
  })
})
