/**
 * A Claude tab's send with attachments on the Anthropic lane (ccr-file-upload.ts switch on) reaches
 * the session in the order the user typed it: words already queued on the tab go first. Review of
 * merge d79b81a2b, 2026-10-15: the files send skipped the queue and posted ahead of them, and a
 * turn-end queue send that was still reading the session status could be overtaken by it.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { buildCcrUserEventBody } from './ccr-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { useCcrComposerSend, type CcrComposerSendDeps, type CcrSendFiles } from './use-ccr-composer-send'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
type Body = ReturnType<typeof buildCcrUserEventBody>

const posts: { body: Body }[] = []
let failText: string | null = null
let statusRead: Promise<string> | null = null
let uuids = 0
const deps: CcrComposerSendDeps = {
  post: async (_accountId, _sessionId, body) => {
    posts.push({ body })
    if (failText !== null && contentOf(body) === failText) { throw new Error('network') }
  },
  readStatus: async () => (statusRead ? statusRead : 'connected'),
  log: () => undefined,
  newUuid: () => `uuid-${(uuids += 1)}`
}
const calls = { restore: vi.fn(), error: vi.fn() }
const origin = (text: string): MobileNativeChatSendOrigin => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true })
let working = false
/** The composer, as setComposerText leaves it. */
let composer = ''
let streamed: string | null = 'connected'
let renderer: ReactTestRenderer | null = null
let api!: ReturnType<typeof useCcrComposerSend>
function Harness(): null {
  api = useCcrComposerSend({
    active: true,
    tabId: 'tab-1',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: 'acct-personal' }),
    events: [],
    connectionStatus: streamed,
    working,
    promptUp: false,
    attachments: () => 0,
    composerText: '',
    setComposerText: (next) => { composer = typeof next === 'function' ? next(composer) : next },
    captureSendOrigin: origin,
    clearDraftForSend: vi.fn(),
    acceptSend: () => 'row-1',
    restoreRejectedDraft: calls.restore, returnQueueToDraft: vi.fn(),
    removePending: vi.fn(),
    onSendError: calls.error,
    deps
  })
  return null
}
function contentOf(body: Body): string {
  return (body.events[0]!.payload as { message: { content: string } }).message.content
}
const sentInOrder = (): string[] => posts.map((post) => contentOf(post.body))
async function send(text: string, files?: CcrSendFiles): Promise<string> {
  let outcome = ''
  await act(async () => {
    outcome = await api.sendWithOutcome(text, files)
  })
  return outcome
}
const PHOTO: CcrSendFiles = { attachments: [{ file_uuid: 'file_01A', file_name: 'image.jpg', is_image: true }], previewUris: ['file:///a.jpg'], accountId: 'acct-personal' }

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  posts.length = 0
  failText = null
  statusRead = null
  streamed = 'connected'
  working = false
  composer = ''
  vi.clearAllMocks()
})

describe('a Claude tab send with files keeps the order the user typed', () => {
  it('words queued while Claude worked reach the session before a later send with a photo', async () => {
    working = true
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(await send('first, typed while Claude worked')).toBe('accepted')
    expect(api.queue).toEqual(['first, typed while Claude worked'])
    expect(await send('second, with a photo', PHOTO)).toBe('accepted')
    expect(sentInOrder()).toEqual(['first, typed while Claude worked', 'second, with a photo'])
    expect(api.queue).toEqual([])
  })

  it('a queued message that fails to post holds the photo send back, so the photo never goes ahead of it', async () => {
    working = true
    act(() => {
      renderer = create(createElement(Harness))
    })
    await send('first')
    failText = 'first'
    expect(await send('second, with a photo', PHOTO)).toBe('rejected')
    expect(sentInOrder()).toEqual(['first'])
  })

  it('queued words that fail ahead of a photo send come back ahead of the words typed after them', async () => {
    working = true
    act(() => {
      renderer = create(createElement(Harness))
    })
    await send('first')
    failText = 'first'
    // The photo send's own words are still in the box when the queued ones come back.
    composer = 'second, with a photo'
    expect(await send('second, with a photo', PHOTO)).toBe('rejected')
    expect(composer).toBe('first\n\nsecond, with a photo')
  })

  it('a photo sent while the turn-end queue send reads the session status does not overtake it', async () => {
    streamed = null
    working = true
    act(() => {
      renderer = create(createElement(Harness))
    })
    await send('first')
    let answer!: (status: string) => void
    statusRead = new Promise((resolve) => { answer = resolve })
    working = false
    act(() => renderer!.update(createElement(Harness)))
    // The queue's status read is out; the photo is tapped now.
    let tapped!: Promise<string>
    act(() => {
      tapped = api.sendWithOutcome('second, with a photo', PHOTO)
    })
    let photo = ''
    await act(async () => {
      answer('connected')
      photo = await tapped
    })
    // One send in flight, as in the app: the photo is refused (its chips come back) and the queue goes.
    expect(photo).toBe('rejected')
    expect(sentInOrder()).toEqual(['first'])
  })

  it('words typed while the turn-end queue send reads the session status wait behind it instead of being refused', async () => {
    streamed = null
    working = true
    act(() => {
      renderer = create(createElement(Harness))
    })
    await send('first')
    let answer!: (status: string) => void
    statusRead = new Promise((resolve) => { answer = resolve })
    working = false
    act(() => renderer!.update(createElement(Harness)))
    let typed!: Promise<string>
    act(() => {
      typed = api.sendWithOutcome('second, words only')
    })
    let outcome = ''
    await act(async () => {
      answer('connected')
      outcome = await typed
    })
    expect(outcome).toBe('accepted')
    expect(calls.error).not.toHaveBeenCalled()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // Since 2026-10-16 the queue goes one message per turn: the words wait for the turn the
    // first one started to end, still behind it.
    expect(sentInOrder()).toEqual(['first'])
    expect(api.queue).toEqual(['second, words only'])
    working = true
    act(() => renderer!.update(createElement(Harness)))
    working = false
    act(() => renderer!.update(createElement(Harness)))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(sentInOrder()).toEqual(['first', 'second, words only'])
  })
})
