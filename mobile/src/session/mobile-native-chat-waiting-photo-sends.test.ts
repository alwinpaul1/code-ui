import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import {
  hydrateWaitingPhotoSends,
  rememberWaitingPhotoSends,
  resetWaitingPhotoSendsForTests,
  waitingPhotoSends,
  withThisRunsPhotos
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
  beforeEach(async () => {
    vi.useFakeTimers()
    await AsyncStorage.clear()
    resetWaitingPhotoSendsForTests()
  })
  afterEach(() => {
    resetWaitingPhotoSendsForTests()
    vi.useRealTimers()
  })

  it('keeps only the sends with photos, marked-up ones too', () => {
    rememberWaitingPhotoSends('s1', [send('pending-1', ['data:image/png;base64,AAAA']), send('pending-2')])
    expect(waitingPhotoSends('s1')?.map((item) => item.id)).toEqual(['pending-1'])
  })

  it('lets a session go once the store writes it with no photo send left', () => {
    rememberWaitingPhotoSends('s1', [send('pending-1', ['file:///a1.jpg'])])
    rememberWaitingPhotoSends('s1', [send('pending-2')])
    expect(waitingPhotoSends('s1')).toEqual([])
    rememberWaitingPhotoSends('s1', [send('pending-1', ['file:///a1.jpg'])])
    rememberWaitingPhotoSends('s1', [])
    expect(waitingPhotoSends('s1')).toEqual([])
    rememberWaitingPhotoSends('s2', [send('pending-3')])
    expect(waitingPhotoSends('s2')).toBeUndefined()
  })

  it('holds the last eight sessions of the run as written, and older ones as storage keeps them', () => {
    for (let index = 0; index < 9; index += 1) {
      rememberWaitingPhotoSends(`s${index}`, [send(`pending-${index}`, [`file:///${index}.jpg`, 'data:image/png;base64,AA'])])
    }
    expect(waitingPhotoSends('s0')?.map((item) => item.images)).toEqual([['file:///0.jpg']])
    expect(waitingPhotoSends('s8')?.map((item) => item.images)).toEqual([['file:///8.jpg', 'data:image/png;base64,AA']])
  })

  it('brings the recent sessions’ photo sends back after a relaunch, without data: previews', async () => {
    rememberWaitingPhotoSends('s1', [
      send('pending-1', ['file:///a1.jpg', 'data:image/png;base64,AA']),
      send('pending-2', ['data:image/png;base64,BB'])
    ])
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    resetWaitingPhotoSendsForTests()
    await hydrateWaitingPhotoSends()
    expect(waitingPhotoSends('s1')?.map((item) => [item.id, item.images])).toEqual([['pending-1', ['file:///a1.jpg']]])
  })

  // The binder finds a send's row by the paths it pasted, one per preview:
  // dropping a `data:` preview must drop its path, not the next photo's.
  it('keeps each remaining photo’s pasted path with it after a relaunch', async () => {
    rememberWaitingPhotoSends('s1', [
      {
        ...send('pending-1', ['data:image/png;base64,AA', 'file:///a2.jpg']),
        imagePaths: ['/var/folders/0y/T/orca-paste-1-a.png', '/var/folders/0y/T/orca-paste-2-b.png']
      }
    ])
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    resetWaitingPhotoSendsForTests()
    await hydrateWaitingPhotoSends()
    expect(waitingPhotoSends('s1')?.map((item) => [item.images, item.imagePaths])).toEqual([
      [['file:///a2.jpg'], ['/var/folders/0y/T/orca-paste-2-b.png']]
    ])
  })

  it('leaves each chat to wait for its own read when the recent copy will not parse', async () => {
    await AsyncStorage.setItem('codeui:chat-waiting-photo-sends-recent', '{not json')
    await expect(hydrateWaitingPhotoSends()).resolves.toBeUndefined()
    expect(waitingPhotoSends('s1')).toBeUndefined()
  })
})

// Storage leaves a `data:` photo out, and the store reads its sends back from
// storage whenever a chat comes back: a send Claude took mid-turn, which gets
// no row, came back with no photo (session 790eafa8, 2026-09-26).
describe('the photos this run still holds, put back on sends read from storage', () => {
  beforeEach(() => resetWaitingPhotoSendsForTests())
  afterEach(() => resetWaitingPhotoSendsForTests())
  const paths = ['/var/folders/0y/T/orca-paste-1-a.png', '/var/folders/0y/T/orca-paste-2-b.png']

  it('puts back the data: photo storage left out, with its pasted path, in order', () => {
    rememberWaitingPhotoSends('s1', [{ ...send('pending-1', ['data:image/png;base64,AA', 'file:///a2.jpg']), imagePaths: paths }])
    const read = [{ ...send('pending-1', ['file:///a2.jpg']), imagePaths: [paths[1]!] }]
    expect(withThisRunsPhotos('s1', read).map((item) => [item.images, item.imagePaths])).toEqual([
      [['data:image/png;base64,AA', 'file:///a2.jpg'], paths]
    ])
  })

  it('leaves a send this run holds nothing more for, another session, and none at all as stored', () => {
    rememberWaitingPhotoSends('s1', [send('pending-1', ['data:image/png;base64,AA'])])
    const read = [send('pending-2'), send('pending-1', ['file:///kept.jpg', 'file:///more.jpg'])]
    expect(withThisRunsPhotos('s1', read)).toEqual(read)
    expect(withThisRunsPhotos('s2', [send('pending-1')])).toEqual([send('pending-1')])
    expect(withThisRunsPhotos('s1', [])).toEqual([])
  })
})
