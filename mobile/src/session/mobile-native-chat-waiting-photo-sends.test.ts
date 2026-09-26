import { afterEach, describe, expect, it } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import {
  rememberWaitingPhotoSends,
  resetWaitingPhotoSendsForTests,
  waitingPhotoSends
} from './mobile-native-chat-waiting-photo-sends'

const send = (id: string, images?: string[]): MobileNativeChatPendingMessage => ({
  id,
  text: 'Now I see 1 shell and 2 agents',
  expectedOccurrence: 1,
  baselineTailMessageId: '94b09904',
  baselineResolved: true,
  ...(images ? { images } : {})
})

// A chat that comes back binds the photos of sends the store has not read
// back yet from these (mobile-chat-phone-photo-landing.test.ts covers the
// frames); here, what is kept and when it is let go.
describe('the photo sends a chat that comes back binds before its read', () => {
  afterEach(() => resetWaitingPhotoSendsForTests())

  it('keeps only the sends with photos, marked-up ones too', () => {
    rememberWaitingPhotoSends('s1', [send('pending-1', ['data:image/png;base64,AAAA']), send('pending-2')])
    expect(waitingPhotoSends('s1')?.map((item) => item.id)).toEqual(['pending-1'])
  })

  it('lets a session go once the store writes it with no photo send left', () => {
    rememberWaitingPhotoSends('s1', [send('pending-1', ['file:///a1.jpg'])])
    rememberWaitingPhotoSends('s1', [send('pending-2')])
    expect(waitingPhotoSends('s1')).toBeUndefined()
    rememberWaitingPhotoSends('s1', [send('pending-1', ['file:///a1.jpg'])])
    rememberWaitingPhotoSends('s1', [])
    expect(waitingPhotoSends('s1')).toBeUndefined()
  })

  it('keeps the last eight sessions of the run', () => {
    for (let index = 0; index < 9; index += 1) {
      rememberWaitingPhotoSends(`s${index}`, [send(`pending-${index}`, [`file:///${index}.jpg`])])
    }
    expect(waitingPhotoSends('s0')).toBeUndefined()
    expect(waitingPhotoSends('s1')?.map((item) => item.id)).toEqual(['pending-1'])
    expect(waitingPhotoSends('s8')?.map((item) => item.id)).toEqual(['pending-8'])
  })
})
