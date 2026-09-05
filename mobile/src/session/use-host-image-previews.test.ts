import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { collectHostImagePaths, mergeImagePreviews } from './use-host-image-previews'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }] } as NativeChatMessage
}

describe('collectHostImagePaths', () => {
  it('lists desktop-pasted image paths per user message, skipping phone sends', () => {
    const messages = [
      user('m1', 'look at this'),
      user('m2', '[Image: source: /var/folders/x/orca-paste-1.png]'),
      user('m3', '[Image: source: /var/folders/x/orca-paste-2.png]'),
      user('m4', '[Image: source: /tmp/phone.png]')
    ]
    const paths = collectHostImagePaths(messages, { m4: ['file:///local/phone.png'] })
    expect(paths.m1).toBeUndefined()
    expect(Object.values(paths).flat()).toEqual([
      '/var/folders/x/orca-paste-1.png',
      '/var/folders/x/orca-paste-2.png'
    ])
    expect(paths.m4).toBeUndefined()
  })
})

describe('mergeImagePreviews', () => {
  it('keeps local previews over host thumbnails for the same message', () => {
    expect(
      mergeImagePreviews(
        { a: ['file:///a.png'] },
        { a: ['data:image/png;base64,x'], b: ['data:b'] }
      )
    ).toEqual({ a: ['file:///a.png'], b: ['data:b'] })
  })
  it('returns the local map untouched when there is nothing from the host', () => {
    const local = { a: ['file:///a.png'] }
    expect(mergeImagePreviews(local, {})).toBe(local)
  })
})
