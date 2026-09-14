import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

function userTurn(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}
function assistantTurn(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('an image send whose preview never rebound', () => {
  it('retires once its own row has landed, instead of standing beside it forever', () => {
    // 2026-09-14, from the phone: one send showed twice — once with the photo
    // and once as text only. An image echo retires ONLY when its local preview
    // is rebound onto the landed row; when that binding misses there is no
    // other way out, so the optimistic bubble outlived the real one.
    const caption = 'Same message goes with images and text glued, fix that bug'
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: caption,
        images: ['file:///local/shot.png'],
        expectedOccurrence: 1,
        baselineTailMessageId: 'a1',
        baselineResolved: true
      } as MobileNativeChatPendingMessage
    ]
    const messages = [assistantTurn('a1', 'working'), userTurn('u2', caption)]
    // No preview was rebound: the set is empty.
    expect(retireLandedMobileNativeChatPending(messages, pending, new Set())).toEqual([])
  })

  it('keeps an image send whose row has not landed', () => {
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: 'not landed yet',
        images: ['file:///local/shot.png'],
        expectedOccurrence: 1,
        baselineTailMessageId: 'a1',
        baselineResolved: true
      } as MobileNativeChatPendingMessage
    ]
    const messages = [assistantTurn('a1', 'working')]
    expect(retireLandedMobileNativeChatPending(messages, pending, new Set())).toEqual(pending)
  })
})

describe('an image send whose preview did rebind', () => {
  it('still retires through the binding path, so the thumbnail is kept', () => {
    // The binding runs first in use-mobile-native-chat-drafts; the fallback
    // above only covers the case where it found nothing. This pins that a bound
    // preview is still recognised, so the photo is not quietly dropped.
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: 'here is the screenshot',
        images: ['file:///local/shot.png'],
        expectedOccurrence: 1,
        baselineTailMessageId: 'a1',
        baselineResolved: true
      } as MobileNativeChatPendingMessage
    ]
    const messages = [assistantTurn('a1', 'working'), userTurn('u2', 'here is the screenshot')]
    expect(retireLandedMobileNativeChatPending(messages, pending, new Set(['p1']))).toEqual([])
  })

  it('keeps a caption-less photo waiting, since it has no text to be sure by', () => {
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: '',
        images: ['file:///local/shot.png'],
        expectedOccurrence: 5,
        baselineTailMessageId: 'a1',
        baselineResolved: true
      } as MobileNativeChatPendingMessage
    ]
    const messages = [assistantTurn('a1', 'working'), userTurn('u2', 'an unrelated message')]
    expect(retireLandedMobileNativeChatPending(messages, pending, new Set())).toEqual(pending)
  })
})
