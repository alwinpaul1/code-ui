/**
 * A Claude tab's send with attachments already at Anthropic (ccr-file-upload.ts): one event carries
 * the words and `file_attachments`, as the Claude app 1.261009.20 posts it (`su8`, `phx`/`rhx`).
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CCR_ATTACHMENT_OTHER_ACCOUNT } from './ccr-attachment-send'
import type { buildCcrUserEventBody } from './ccr-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { useCcrComposerSend, type CcrComposerSendDeps, type CcrSendFiles } from './use-ccr-composer-send'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
type Body = ReturnType<typeof buildCcrUserEventBody>

const posts: { accountId: string; sessionId: string; body: Body }[] = []
let fail = false
const deps: CcrComposerSendDeps = {
  post: async (accountId, sessionId, body) => {
    posts.push({ accountId, sessionId, body })
    if (fail) { throw new Error('network') }
  },
  readStatus: async () => 'connected',
  log: () => undefined,
  newUuid: () => 'uuid-1'
}
const calls = { accept: vi.fn((_o: MobileNativeChatSendOrigin, _t: string, _i?: string[]) => 'row-1' as string | null), restore: vi.fn(), error: vi.fn() }
const origin = (text: string): MobileNativeChatSendOrigin => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true })
let working = false
let renderer: ReactTestRenderer | null = null
let api!: ReturnType<typeof useCcrComposerSend>
function Harness(): null {
  api = useCcrComposerSend({
    active: true,
    tabId: 'tab-1',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: 'acct-personal' }),
    events: [],
    connectionStatus: 'connected',
    working,
    promptUp: false,
    attachments: () => 0,
    composerText: '',
    setComposerText: vi.fn(),
    captureSendOrigin: origin,
    clearDraftForSend: vi.fn(),
    acceptSend: calls.accept,
    restoreRejectedDraft: calls.restore, returnQueueToDraft: vi.fn(),
    removePending: vi.fn(),
    onSendError: calls.error,
    deps
  })
  return null
}
function render(): void {
  act(() => {
    renderer = create(createElement(Harness))
  })
}
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
  fail = false
  working = false
  vi.clearAllMocks()
})

describe('a Claude tab send with attachments at Anthropic', () => {
  it('posts the words and the finished files in one event, and draws the bubble with the photo', async () => {
    render()
    expect(await send('what is this', PHOTO)).toBe('accepted')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.accountId).toBe('acct-personal')
    expect(posts[0]!.body.events).toEqual([{ payload: { type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'what is this' }, file_attachments: [{ file_uuid: 'file_01A', file_name: 'image.jpg', is_image: true }] } }])
    expect(calls.accept).toHaveBeenCalledWith(expect.anything(), 'what is this', ['file:///a.jpg'])
  })

  it('sends a bare attachment with no words', async () => {
    render()
    expect(await send('', PHOTO)).toBe('accepted')
    expect(posts[0]!.body.events[0]!.payload).toMatchObject({ message: { content: '' }, file_attachments: [{ file_uuid: 'file_01A' }] })
  })

  it('refuses files uploaded under another account than the tab target, posting nothing', async () => {
    render()
    expect(await send('hi', { ...PHOTO, accountId: 'acct-work' })).toBe('rejected')
    expect(posts).toHaveLength(0)
    expect(calls.error).toHaveBeenCalledWith(CCR_ATTACHMENT_OTHER_ACCOUNT)
  })

  it('sends files at once while Claude works, since the phone queue holds words only', async () => {
    working = true
    render()
    expect(await send('and this', PHOTO)).toBe('accepted')
    expect(posts).toHaveLength(1)
    expect(api.queue).toBeNull()
  })

  it('a failed POST gives the words back and reports rejected, so the chips come back too', async () => {
    fail = true
    render()
    expect(await send('hi', PHOTO)).toBe('rejected')
    expect(calls.restore).toHaveBeenCalledWith(expect.anything(), 'hi')
  })
})
