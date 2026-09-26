import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { noteLiveRowsArrived } from './mid-turn-written-before'
import {
  buildMobileNativeChatTransientData,
  foldMobileNativeChatMessages,
  pendingFoldBoundaries
} from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

// Which row takes the phone's photos, through the real draft store: cases a
// reviewer found on 2026-09-26 in the checks that keep a photo off an older
// row (findLandedImagePreviewEchoes), each shown failing first. Row shapes as
// Claude Code 2.1.281 to 2.1.283 write them: the prompt's `[Image #N]`
// markers, then one `[Image: source: …]` companion the same millisecond. A
// clipboard paste's preview is its data: URL (mobile-image-source-picker.ts,
// pickFromClipboard).
vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
type Bubble = { id: string; images: string; text: string }
const at = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
const TEMP = '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T'
const uuid = (n: number) => `${String(n).padStart(8, '0')}-2222-4333-8444-555566667777`
const row = (id: string, role: 'user' | 'assistant', texts: readonly string[], stamp: number): NativeChatMessage => ({
  id,
  role,
  blocks: texts.map((text) => ({ type: 'text' as const, text })),
  timestamp: stamp,
  source: 'transcript'
})
const companion = (id: string, count: number, stamp: number, seed: number) =>
  row(
    id,
    'user',
    Array.from({ length: count }, (_, index) => `[Image: source: ${TEMP}/orca-paste-${stamp + index}-${uuid(seed + index)}.png]`),
    stamp
  )
const markers = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => `[Image #${first + index}]`).join(' ')

function bubbles(messages: NativeChatMessage[], drafts: Drafts): Bubble[] {
  const folded = foldMobileNativeChatMessages(messages, pendingFoldBoundaries(drafts.pending))
  const { data } = buildMobileNativeChatTransientData({
    messages,
    folded,
    streaming: null,
    pending: drafts.pending,
    imagePreviewsByMessageId: drafts.imagePreviewsByMessageId
  })
  return data
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id.startsWith('pending-') ? 'echo' : message.id,
      images: message.blocks
        .map((block) => (block.type !== 'image-ref' ? '' : isDesktopImageRef(block) ? 'D' : 'P'))
        .join(''),
      text: message.blocks
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim()
    }))
}

describe('which row takes the phone’s photos', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let messagesNow: NativeChatMessage[] = []
  let loadingNow = false
  const frames: Bubble[][] = []

  beforeEach(() => {
    vi.useFakeTimers()
    frames.length = 0
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
  })

  function Route({ messages, loading }: { messages: NativeChatMessage[]; loading: boolean }): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'b9d4c0de-0000-4000-8000-000000000001',
      messages,
      transcriptLoading: loading,
      transcriptSettled: !loading
    })
    frames.push(bubbles(messages, drafts))
    return null
  }
  async function show(messages: NativeChatMessage[], loading = false): Promise<void> {
    messagesNow = messages
    loadingNow = loading
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Route, { messages, loading }))
      } else {
        renderer = create(createElement(Route, { messages, loading }))
      }
    })
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        vi.advanceTimersByTime(300)
        await Promise.resolve()
      })
    }
  }
  async function send(text: string, photos: readonly string[], pasted?: readonly string[]): Promise<void> {
    const origin = drafts!.captureSendOrigin(text)!
    await act(async () => {
      drafts!.acceptSend(origin, text, [...photos], pasted ? [...pasted] : undefined)
    })
    await show(messagesNow, loadingNow)
  }
  const drawn = () => bubbles(messagesNow, drafts!)

  // A clipboard paste's preview is its data: URL, the same string every time
  // the same image is pasted. A check that took any row already drawing a
  // send's images as that send's bound the second send of one screenshot to
  // the first row: its bubble went before its row landed, and the row then
  // drew "Image on Desktop".
  it('keeps the second send of the same pasted screenshot until its own row lands, and draws it there', async () => {
    const SHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const history = [row('a0', 'assistant', ['Ready.'], at('09:00:00.000'))]
    vi.setSystemTime(at('09:30:00.000'))
    await show(history)
    await send('what is wrong here', [SHOT])
    const first = [
      ...history,
      row('r1', 'user', [`${markers(1, 1)} what is wrong here`], at('09:30:00.500')),
      companion('c1', 1, at('09:30:00.500'), 1),
      row('a1', 'assistant', ['A missing import.'], at('09:30:10.000'))
    ]
    await show(first)
    vi.setSystemTime(at('09:31:00.000'))
    await send('and now', [SHOT])
    const waiting = drafts!.pending.map((item) => item.text)
    const second = [
      ...first,
      row('r2', 'user', [`${markers(2, 1)} and now`], at('09:31:00.500')),
      companion('c2', 1, at('09:31:00.500'), 2)
    ]
    await show(second)
    expect({ waiting, drawn: drawn() }).toEqual({
      waiting: ['and now'],
      drawn: [
        { id: 'r1', images: 'P', text: 'what is wrong here' },
        { id: 'r2', images: 'P', text: 'and now' }
      ]
    })
  })

  // A row naming more photos than its send had (one already on the agent's
  // input line: the "row naming three" case) has room left, and the next
  // photo sent with no words went into it instead of its own row.
  it('draws two photos sent with no words on their own rows when the first row names one more photo than its send had', async () => {
    const history = [row('a0', 'assistant', ['Ready.'], at('09:00:00.000'))]
    vi.setSystemTime(at('09:30:00.000'))
    await show(history)
    await send('', ['file:///phone/one.jpg'])
    vi.setSystemTime(at('09:30:00.200'))
    await send('', ['file:///phone/two.jpg'])
    const landed = [
      ...history,
      row('r1', 'user', [markers(1, 2)], at('09:30:00.500')),
      companion('c1', 2, at('09:30:00.500'), 10),
      row('r2', 'user', [markers(3, 1)], at('09:30:01.500')),
      companion('c2', 1, at('09:30:01.500'), 20)
    ]
    await show(landed)
    expect(drawn()).toEqual([
      { id: 'r1', images: 'PD', text: '' },
      { id: 'r2', images: 'P', text: '' }
    ])
  })

  // A check that set the send's time against the row's stamp refused a
  // send's own row with the phone's clock 90 s ahead, and a photo with no
  // words retires only by binding: its bubble stood beside a chip until a
  // live row showed the phone's lead.
  it('draws a photo with no words once in every frame, sent before the read settled, with the phone’s clock 90 s ahead', async () => {
    const desk = (clock: string) => at(clock) - 90_000
    const kept = [row('a0', 'assistant', ['Earlier answer.'], desk('09:00:00.000'))]
    vi.setSystemTime(at('09:29:00.000'))
    await show(kept, true)
    vi.setSystemTime(at('09:30:03.500'))
    await send('', ['file:///phone/p17.jpg'])
    const from = frames.length
    const settled = [
      ...kept,
      row('add90135', 'user', [markers(17, 1)], desk('09:30:03.923')),
      companion('344189e5', 1, desk('09:30:03.923'), 30)
    ]
    await show(settled)
    // The agent's reply comes in live some seconds later.
    vi.setSystemTime(at('09:30:13.300'))
    const reply = row('d4f3162c', 'assistant', ['Here is what the photo shows.'], desk('09:30:13.156'))
    noteLiveRowsArrived([reply], Date.now())
    await show([...settled, reply])
    const afterSend = frames.slice(from)
    // Right in every frame, not only once a live row arrives.
    expect(afterSend.at(-1)).toEqual([{ id: 'add90135', images: 'P', text: '' }])
    expect(afterSend.filter((frame) => frame.length !== 1 || frame[0]!.images !== 'P')).toEqual([])
  })

  // 2026-09-26, Claude Code 2.1.283 (the Thesis session, the `[Image #17]` row
  // and its `[Image: source: …]` companion): a photo sent with no words
  // before the chat's read settled drew "Image on Desktop" on its own row
  // while an older photo row drew it. Here the older row is a photo pasted on
  // the desktop that Claude answered within seconds, so no span of time tells
  // it from the send's own row. The path the phone pasted does: the
  // companion names it, and names another path on the older row.
  it('draws a photo with no words on the row that names the path it pasted, not an older desktop photo answered seconds before', async () => {
    const mine = `${TEMP}/orca-paste-1790415003275-839747e3-c083-46eb-b11e-4ea29a8da649.png`
    const older = [
      row('d1', 'user', [markers(16, 1)], at('09:29:58.000')),
      companion('dc1', 1, at('09:29:58.000'), 50),
      row('a1', 'assistant', ['That is the login screen.'], at('09:30:01.000'))
    ]
    vi.setSystemTime(at('09:29:00.000'))
    await show([], true)
    vi.setSystemTime(at('09:30:03.500'))
    await send('', ['file:///phone/p17.jpg'], [mine])
    const from = frames.length
    await show(older)
    await show([
      ...older,
      row('add90135', 'user', [markers(17, 1)], at('09:30:03.923')),
      row('344189e5', 'user', [`[Image: source: ${mine}]`], at('09:30:03.923'))
    ])
    expect(drawn()).toEqual([
      { id: 'd1', images: 'D', text: '' },
      { id: 'add90135', images: 'P', text: '' }
    ])
    expect(frames.slice(from).filter((frame) => frame.some((bubble) => bubble.id === 'd1' && bubble.images !== 'D'))).toEqual([])
  })

  // The same for a photo WITH words: its row refused, the send retired by its
  // words anyway, and the photos went with it for good.
  it('keeps the phone’s photo on a row with words, sent before the read settled, with the phone’s clock 90 s ahead', async () => {
    const desk = (clock: string) => at(clock) - 90_000
    const kept = [row('a0', 'assistant', ['Earlier answer.'], desk('09:00:00.000'))]
    vi.setSystemTime(at('09:29:00.000'))
    await show(kept, true)
    vi.setSystemTime(at('09:30:03.500'))
    await send('what does this show', ['file:///phone/p17.jpg'])
    const settled = [
      ...kept,
      row('add90135', 'user', [`${markers(17, 1)} what does this show`], desk('09:30:03.923')),
      companion('344189e5', 1, desk('09:30:03.923'), 40)
    ]
    await show(settled)
    vi.setSystemTime(at('09:30:13.300'))
    const reply = row('d4f3162c', 'assistant', ['A chart.'], desk('09:30:13.156'))
    noteLiveRowsArrived([reply], Date.now())
    await show([...settled, reply])
    expect(drawn()).toEqual([{ id: 'add90135', images: 'P', text: 'what does this show' }])
  })
})
