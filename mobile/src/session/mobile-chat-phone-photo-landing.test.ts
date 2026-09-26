import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { mergeImagePreviews } from './use-host-image-previews'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { sentPhotosFromScreen } from './mobile-terminal-sent-photos'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import {
  hydrateNativeChatImagePreviewCache,
  resetNativeChatImagePreviewCacheForTests
} from './mobile-native-chat-image-preview-cache'
import { hydrateWaitingPhotoSends, resetWaitingPhotoSendsForTests } from './mobile-native-chat-waiting-photo-sends'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))
// Every render the chat list is handed, not only the settled one: the defect
// lived in a single render between two effects.
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

import {
  SESSION,
  at,
  TEXT1,
  TEXT2,
  TEMP,
  PATHS1,
  PATHS2,
  PHOTOS1,
  PHOTOS2,
  agentRow,
  userRow,
  markers,
  promptRow,
  companionRow,
  before,
  P1,
  C1,
  reply1,
  P2,
  C2,
  hookCopy,
  claudeScreen,
  bubblesIn,
  words,
  type Tick,
  type Drafts,
  type Bubble
} from './mobile-chat-phone-photo-landing.fixtures'


describe('a message the phone sent with photos, as its row lands', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let current: Tick = { messages: before }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(at('07:00:00.000'))
    frames.length = 0
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
  })

  /** The real draft store feeding the real overlay, with the host's previews
   *  not in yet: only what the phone holds can draw a picture. */
  function Route({ tick }: { tick: Tick }) {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: SESSION,
      messages: tick.messages,
      transcriptLoading: tick.loading ?? false,
      transcriptSettled: !tick.loading
    })
    const controller = {
      showNativeChat: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: {
        messages: tick.messages,
        status: tick.loading ? 'loading' : 'ready',
        transcriptLoading: tick.loading ?? false
      },
      nativeChatAgent: tick.agent ?? 'claude',
      nativeChatStructured: false,
      nativeChatAgentWorking: tick.working ?? false,
      nativeChatStreamLive: tick.working ?? false,
      nativeChatStreamScopeKey: `tab:${SESSION}`,
      nativeChatSpinner: null,
      chatPending: drafts.pending,
      rememberEcho: drafts.rememberEcho,
      takeOwnSends: drafts.takeSends,
      nativeChatDesktopPrompts: tick.prompts,
      nativeChatQueuedMessages: tick.queued ?? [],
      nativeChatScreenSentPhotos: tick.screen ? sentPhotosFromScreen(tick.screen) : [],
      chatImagePreviewsByMessageId: mergeImagePreviews(drafts.imagePreviewsByMessageId, {}),
      chatComposerText: '',
      setChatComposerText: vi.fn()
    } as unknown as MobileNativeChatController
    return createElement(MobileNativeChatOverlay, {
      controller,
      hasTerminalUnderneath: true,
      hostAllowsRewind: true,
      images: {} as never,
      onMicPress: vi.fn(),
      micActive: false,
      dictationMode: 'toggle',
      onMicPressIn: vi.fn(),
      onMicPressOut: vi.fn(),
      inputLockReason: null,
      sendErrorMessage: null,
      onClearSendError: vi.fn(),
      sendSurfaceId: 'tab',
      getSendCompletionGeneration: () => 0,
      keyboardInset: 0,
      onOpenFile: vi.fn()
    })
  }

  async function show(clock: string, tick: Tick): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
    current = tick
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Route, { tick }))
      } else {
        renderer = create(createElement(Route, { tick }))
      }
    })
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  /** Send from the phone: the composer's words and the local previews of the
   *  photos that rode along. */
  /** The desktop path the terminal paste typed for each photo, as the app
   *  records it (use-mobile-native-chat-image-attachments.ts): the fixture's
   *  own for the session's photos, none where a case does not say. */
  const PASTED = new Map([
    ...PHOTOS1.map((photo, index) => [photo, `${TEMP}/${PATHS1[index]}.png`] as const),
    ...PHOTOS2.map((photo, index) => [photo, `${TEMP}/${PATHS2[index]}.png`] as const),
    // The photos with no words below, and the Codex one.
    ['file:///phone/p17.jpg', `${TEMP}/${PATHS1[0]}.png`],
    ['file:///phone/p16.jpg', `${TEMP}/${PATHS2[0]}.png`],
    ['file:///phone/e1.jpg', `${TEMP}/orca-paste-1788692837713-14c67aef-b415-4e02-af69-9b7196dbe54e.png`]
  ])
  async function send(clock: string, body: string, photos: readonly string[], pasted?: readonly string[]): Promise<void> {
    vi.setSystemTime(at(clock))
    const origin = drafts!.captureSendOrigin(body)!
    const paths = pasted ?? (photos.length > 0 && photos.every((photo) => PASTED.has(photo)) ? photos.map((photo) => PASTED.get(photo)!) : undefined)
    await act(async () => {
      drafts!.acceptSend(origin, body, [...photos], paths ? [...paths] : undefined)
    })
    await show(clock, current)
  }

  /** Every render from `from` on, as its user bubbles. */
  const framesFrom = (from: number): Bubble[][] => frames.slice(from).map(bubblesIn)
  const lastFrame = (): Bubble[] => bubblesIn(frames.at(-1)!)
  /** The bubbles in a frame that carry these words. */
  const drawing = (frame: Bubble[], body: string) => frame.filter((bubble) => bubble.text === words(body))

  describe('sent while Claude was idle (session 967668df, lines 23621 to 23682)', () => {
    it.each([
      ['with its photos in the same read', [[...before, P1, C1]]],
      ['before its photos', [[...before, P1], [...before, P1, C1]]]
    ])(
      'never draws the phone’s own photos as Image on Desktop, in any frame, when its row lands %s',
      async (_label, reads) => {
        await show('07:00:00.000', { messages: before })
        await send('07:00:18.000', TEXT1, PHOTOS1)
        const sent = frames.length
        const prompts = hookCopy('07:00:19.600', `${markers(67, 3)} ${TEXT1}`)
        await show('07:00:19.650', { messages: before, prompts })
        for (const [index, messages] of reads.entries()) {
          await show(`07:00:2${index}.000`, { messages, working: true, prompts })
        }
        await show('07:02:24.000', { messages: [...reads.at(-1)!, reply1], prompts })
        for (const frame of framesFrom(sent)) {
          expect(drawing(frame, TEXT1)).toEqual([expect.objectContaining({ images: 'PPP' })])
          expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
        }
        expect(lastFrame()).toEqual([{ id: '40b55aba', images: 'PPP', text: words(TEXT1) }])
      }
    )

    it('draws the second of two three-photo messages once, with its own photos, and no bubble of chips under it', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await show('07:00:20.000', { messages: [...before, P1, C1], working: true })
      await show('07:02:24.000', { messages: [...before, P1, C1, reply1] })
      await send('07:02:53.000', TEXT2, PHOTOS2)
      const sent = frames.length
      await show('07:02:55.000', { messages: [...before, P1, C1, reply1, P2], working: true })
      await show('07:02:55.500', { messages: [...before, P1, C1, reply1, P2, C2], working: true })
      for (const frame of framesFrom(sent)) {
        expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
        expect(drawing(frame, TEXT2)).toEqual([expect.objectContaining({ images: 'PPP' })])
      }
      expect(lastFrame()).toEqual([
        { id: '40b55aba', images: 'PPP', text: words(TEXT1) },
        { id: 'e96491cb', images: 'PPP', text: words(TEXT2) }
      ])
      // Each row keeps its own photos: the first message's companion must not
      // move down to the second message because both carry three.
      const folded = frames.at(-1)!.folded as NativeChatMessage[]
      const pathsOf = (id: string) =>
        folded
          .find((message) => message.id === id)!
          .blocks.flatMap((block) => (block.type === 'image-ref' && block.path ? [block.path] : []))
      expect(pathsOf('e96491cb')).toEqual(PATHS2.map((file) => `${TEMP}/${file}.png`))
      expect(pathsOf('40b55aba')).toEqual(PATHS1.map((file) => `${TEMP}/${file}.png`))
    })

    // The same frame drew every send twice, words alone too: the bubble and
    // its row, until the effect retired the bubble.
    it('draws a message with no photos once in every frame as its row lands', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', 'How many agents are working now and how shells', [])
      const sent = frames.length
      const row = userRow('6b0d1067', ['How many agents are working now and how shells'], '07:00:18.256')
      await show('07:00:19.000', { messages: [...before, row], working: true })
      for (const frame of framesFrom(sent)) {
        expect(frame).toHaveLength(1)
      }
      expect(lastFrame()).toEqual([
        { id: '6b0d1067', images: '', text: 'How many agents are working now and how shells' }
      ])
    })

    // The degenerate sizes: one photo, and photos with no words (the prompt
    // row is then the markers alone).
    it.each([
      ['one photo', 1, 'a single photo from the phone', ['file:///phone/one.jpg']],
      ['three photos and no words', 3, '', PHOTOS1],
      ['one photo and no words', 1, '', ['file:///phone/one.jpg']]
    ])('keeps %s in the bubble in every frame as the row lands', async (_label, count, body, photos) => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', body, photos)
      const sent = frames.length
      const landed = [...before, promptRow('d1d2d3d4', 90, count, body, '07:00:19.716'), companionRow('d5d6d7d8', PATHS1.slice(0, count), '07:00:19.716')]
      await show('07:00:20.000', { messages: landed.slice(0, 2), working: true })
      await show('07:00:20.500', { messages: landed, working: true })
      const expected = 'P'.repeat(count)
      for (const frame of framesFrom(sent)) {
        expect(frame).toEqual([expect.objectContaining({ images: expected, text: words(body) })])
      }
      expect(lastFrame()).toEqual([{ id: 'd1d2d3d4', images: expected, text: words(body) }])
    })

    // The phone's count and the row's can disagree (a picture that failed to
    // attach, or one already on the agent's input line). The row is still the
    // phone's message, drawn once; a picture the phone never had is the chip.
    it.each([
      ['two photos, a row naming three', ['file:///phone/x1.jpg', 'file:///phone/x2.jpg'], 3, 'PPD'],
      ['three photos, a row naming two', PHOTOS1, 2, 'PPP']
    ])('draws one bubble when the phone sent %s', async (_label, photos, count, expected) => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, photos)
      const sent = frames.length
      const landed = [...before, promptRow('e1e2e3e4', 67, count, TEXT1, '07:00:19.716'), companionRow('e5e6e7e8', PATHS1.slice(0, count), '07:00:19.716')]
      await show('07:00:20.000', { messages: landed, working: true })
      for (const frame of framesFrom(sent)) {
        expect(drawing(frame, TEXT1)).toHaveLength(1)
      }
      expect(lastFrame()).toEqual([{ id: 'e1e2e3e4', images: expected, text: words(TEXT1) }])
    })

    // Leaving the project tears the chat down; coming back paints the kept
    // transcript at once, so the photos must be there in that first frame too,
    // and after a relaunch, once the app-start caches are read.
    it.each([
      ['after the chat comes back', false],
      ['after the app is relaunched', true]
    ])('keeps the phone’s photos in the first frame %s', async (_label, relaunch) => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await show('07:00:20.000', { messages: [...before, P1, C1], working: true })
      await show('07:00:21.000', { messages: [...before, P1, C1, reply1] })
      act(() => renderer?.unmount())
      renderer = null
      if (relaunch) {
        // The run goes on long enough for its writes to land, then ends.
        for (let turn = 0; turn < 3; turn += 1) {
          await act(async () => {
            vi.advanceTimersByTime(1_000)
            await Promise.resolve()
          })
        }
        resetNativeChatImagePreviewCacheForTests()
        await hydrateNativeChatImagePreviewCache()
      }
      const back = frames.length
      await show('07:05:00.000', { messages: [...before, P1, C1, reply1] })
      expect(frames.length).toBeGreaterThan(back)
      for (const frame of framesFrom(back)) {
        expect(frame).toEqual([{ id: '40b55aba', images: 'PPP', text: words(TEXT1) }])
      }
    })

    // Review, 2026-09-26: the store reads its sends back in an effect after
    // the chat comes back, so a row that landed while the chat was away (a
    // photo queued mid-turn and dequeued at the turn's end while the user was
    // in another project) was drawn from the row alone until then.
    it.each([
      ['the chat comes back', false],
      ['the app is relaunched', true]
    ])('keeps the phone’s photos in the first frame after %s, when their row landed while it was away', async (_label, relaunch) => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await show('07:00:19.000', { messages: before })
      act(() => renderer?.unmount())
      renderer = null
      await act(async () => {
        await Promise.resolve()
      })
      if (relaunch) {
        for (let turn = 0; turn < 3; turn += 1) {
          await act(async () => {
            vi.advanceTimersByTime(1_000)
            await Promise.resolve()
          })
        }
        resetNativeChatImagePreviewCacheForTests()
        resetWaitingPhotoSendsForTests()
        await hydrateNativeChatImagePreviewCache()
        await hydrateWaitingPhotoSends()
      }
      const back = frames.length
      await show('07:02:30.000', { messages: [...before, P1, C1, reply1] })
      expect(frames.length).toBeGreaterThan(back)
      for (const frame of framesFrom(back)) {
        expect(frame).toEqual([{ id: '40b55aba', images: 'PPP', text: words(TEXT1) }])
      }
    })

    // A marked-up photo, or a clipboard paste with no file, is a `data:`
    // preview, which storage leaves out for its size cap (review, 2026-09-26).
    it('keeps a marked-up photo a picture in the first frame after the chat comes back in the same run', async () => {
      const marked = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', 'data:image/png;base64,CCCC']
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, marked)
      await show('07:00:20.000', { messages: [...before, P1, C1], working: true })
      await show('07:00:21.000', { messages: [...before, P1, C1, reply1] })
      act(() => renderer?.unmount())
      renderer = null
      const back = frames.length
      await show('07:05:00.000', { messages: [...before, P1, C1, reply1] })
      expect(frames.length).toBeGreaterThan(back)
      for (const frame of framesFrom(back)) {
        expect(frame).toEqual([{ id: '40b55aba', images: 'PPP', text: words(TEXT1) }])
      }
    })
  })

  // Reported 2026-09-26 against Claude Code 2.1.283, session 76ba8f2f (a
  // Thesis session), 1-based lines 4941 and 4944: a photo sent from the phone
  // with no words, 30 minutes after the last turn (an away_summary sits
  // between). The prompt row's text is the marker alone, "[Image #17]", and
  // its companion, the same millisecond, is one `[Image: source: …]` block
  // of 131 characters, the form 2.1.281 writes. The phone drew the new row
  // as one "Image on Desktop" chip: sent before the chat's read settled, a
  // photo with no words has only the order of photo rows to go by, and took
  // the first one after whatever the phone had on screen, an older one.
  describe('a photo with no words, sent before the chat’s read settled (Claude Code 2.1.283)', () => {
    const PHOTO = ['file:///phone/p17.jpg']
    const earlier = [
      agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
      promptRow('4665aaaa', 16, 1, '', '08:43:47.644'),
      companionRow('4670aaaa', PATHS2.slice(0, 1), '08:43:47.644'),
      agentRow('4671aaaa', 'Looked at the earlier photo.', '08:44:10.000'),
      agentRow('0b0bbe84', 'Final answer of that turn.', '08:57:06.630')
    ]
    const P17 = promptRow('add90135', 17, 1, '', '09:30:03.923')
    const C17 = companionRow('344189e5', PATHS1.slice(0, 1), '09:30:03.923')
    const reply = agentRow('d4f3162c', 'Here is what the photo shows.', '09:30:13.156')

    it.each([
      ['an earlier visit’s transcript', earlier.slice(0, 1)],
      ['nothing yet', []]
    ])('draws it on its own row, not an older photo message’s, when the chat showed %s', async (_label, onScreen) => {
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: onScreen, loading: true })
      await send('09:30:03.500', '', PHOTO)
      const landedFrom = frames.length
      await show('09:30:04.000', { messages: [...earlier, P17, C17], working: true })
      await show('09:30:14.000', { messages: [...earlier, P17, C17, reply] })
      for (const frame of framesFrom(landedFrom)) {
        expect(frame).toEqual([
          { id: '4665aaaa', images: 'D', text: '' },
          { id: 'add90135', images: 'P', text: '' }
        ])
      }
      expect((frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>)['add90135']).toEqual(PHOTO)
    })

    it('keeps it off an older photo the phone sent a moment before, which keeps its own', async () => {
      vi.setSystemTime(at('09:29:00.000'))
      const first = promptRow('4665bbbb', 16, 1, '', '09:29:31.000')
      const firstCompanion = companionRow('4670bbbb', PATHS2.slice(0, 1), '09:29:31.000')
      await show('09:29:00.000', { messages: earlier.slice(0, 1) })
      await send('09:29:30.000', '', ['file:///phone/p16.jpg'])
      await show('09:29:32.000', { messages: [...earlier.slice(0, 1), first, firstCompanion] })
      // The chat goes and comes back, and a second photo is sent at once.
      act(() => renderer?.unmount())
      renderer = null
      await show('09:30:00.000', { messages: earlier.slice(0, 1), loading: true })
      await send('09:30:03.500', '', PHOTO)
      await show('09:30:04.000', { messages: [...earlier.slice(0, 1), first, firstCompanion, P17, C17], working: true })
      const drawn = frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>
      expect([drawn['4665bbbb'], drawn['add90135']]).toEqual([['file:///phone/p16.jpg'], PHOTO])
      expect(lastFrame()).toEqual([
        { id: '4665bbbb', images: 'P', text: '' },
        { id: 'add90135', images: 'P', text: '' }
      ])
    })

    // Review, 2026-09-26: the checks above, first written, refused the send's
    // own row when the phone's clock ran more than a minute ahead, and two
    // photo sends glued into one row kept the second one's bubble for good.
    it('draws a photo with no words once, as the phone’s picture, when the phone’s clock runs 90 s ahead', async () => {
      const ahead = (row: NativeChatMessage): NativeChatMessage => ({ ...row, timestamp: row.timestamp! - 90_000 })
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: earlier.map(ahead) })
      await send('09:30:03.500', '', PHOTO)
      const landedFrom = frames.length
      await show('09:30:04.000', { messages: [...earlier, P17, C17].map(ahead), working: true })
      for (const frame of framesFrom(landedFrom)) {
        expect(frame).toEqual([
          { id: '4665aaaa', images: 'D', text: '' },
          { id: 'add90135', images: 'P', text: '' }
        ])
      }
    })

    // The ordinal a photo with no words is sent with counts the photo sends
    // still waiting then. With the rows of retired sends left out, the second
    // of two such sends counted past its own row and never left.
    it('draws two photos sent with no words on their own rows when the second row lands a read later', async () => {
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: earlier })
      await send('09:30:01.000', '', ['file:///phone/one.jpg'])
      await send('09:30:02.000', '', ['file:///phone/two.jpg'])
      const first = [promptRow('r1r1r1r1', 18, 1, '', '09:30:02.500'), companionRow('r1c1r1c1', PATHS1.slice(0, 1), '09:30:02.500')]
      const second = [promptRow('r2r2r2r2', 19, 1, '', '09:30:04.500'), companionRow('r2c2r2c2', PATHS1.slice(1, 2), '09:30:04.500')]
      await show('09:30:03.000', { messages: [...earlier, ...first], working: true })
      await show('09:30:05.000', { messages: [...earlier, ...first, ...second], working: true })
      expect(drafts!.pending).toEqual([])
      const drawn = frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>
      expect([drawn['r1r1r1r1'], drawn['r2r2r2r2']]).toEqual([['file:///phone/one.jpg'], ['file:///phone/two.jpg']])
    })

    it('draws two photo sends glued into one row once, with both photos, and no bubble left over', async () => {
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: earlier, working: true })
      await send('09:30:01.000', 'look at this', ['file:///phone/a.jpg'])
      await send('09:30:02.000', 'and this one', ['file:///phone/b.jpg'])
      const glued = promptRow('g1g1g1g1', 1, 1, 'look at this [Image #2] and this one', '09:30:05.000')
      const gluedCompanion = companionRow('g2g2g2g2', PATHS1.slice(0, 2), '09:30:05.000')
      await show('09:30:06.000', { messages: [...earlier, glued, gluedCompanion], working: true })
      await show('09:30:07.000', { messages: [...earlier, glued, gluedCompanion], working: true })
      expect(drafts!.pending).toEqual([])
      expect(lastFrame()).toEqual([
        { id: '4665aaaa', images: 'D', text: '' },
        { id: 'g1g1g1g1', images: 'PP', text: 'look at this and this one' }
      ])
      expect((frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>)['g1g1g1g1']).toEqual([
        'file:///phone/a.jpg',
        'file:///phone/b.jpg'
      ])
    })

    it('draws a photo with words, sent before the read settled, on its own row and not an older one with the same words', async () => {
      const olderSame = [
        agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
        promptRow('old1old1', 16, 1, 'what about this one', '08:43:47.644'),
        companionRow('old2old2', PATHS2.slice(0, 1), '08:43:47.644'),
        agentRow('0b0bbe84', 'That one is fine.', '08:44:10.000')
      ]
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: [], loading: true })
      await send('09:30:03.500', 'what about this one', PHOTO)
      const mine = promptRow('new1new1', 17, 1, 'what about this one', '09:30:03.923')
      await show('09:30:04.000', { messages: [...olderSame, mine, C17], working: true })
      expect(lastFrame()).toEqual([
        { id: 'old1old1', images: 'D', text: 'what about this one' },
        { id: 'new1new1', images: 'P', text: 'what about this one' }
      ])
    })
  })

  describe('what is not the phone’s own photo', () => {
    it('still draws a photo pasted on the desktop as Image on Desktop, and never hands it the phone’s photos', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      // Before the phone's row lands, a message pasted at the desk lands.
      const desk = [...before, promptRow('f1f2f3f4', 5, 1, 'pasted at the desk', '07:00:18.500'), companionRow('f5f6f7f8', PATHS2.slice(0, 1), '07:00:18.500')]
      await show('07:00:19.000', { messages: desk, working: true })
      // The phone's bubble stays where it was sent, above the desk's row.
      expect(lastFrame()).toEqual([
        expect.objectContaining({ images: 'PPP', text: words(TEXT1) }),
        { id: 'f1f2f3f4', images: 'D', text: 'pasted at the desk' }
      ])
      const both = [...desk, P1, C1]
      await show('07:00:20.000', { messages: both, working: true })
      expect(lastFrame()).toEqual([
        { id: 'f1f2f3f4', images: 'D', text: 'pasted at the desk' },
        { id: '40b55aba', images: 'PPP', text: words(TEXT1) }
      ])
    })

    // Captured with `tmux capture-pane -p` from Claude Code 2.1.281: two
    // messages from the Claude app, whose photos reach Claude inline and the
    // phone never, and one pasted in the terminal, the way the phone pastes.
    it('draws the Claude app’s photos as Image on Desktop beside the phone’s own, which stay pictures', async () => {
      const screen = readFileSync(
        fileURLToPath(new URL('./fixtures/claude-screen-sent-photos-2.1.281.txt', import.meta.url)),
        'utf8'
      ).split('\n')
      const app = [
        ...before,
        userRow('a1a1a1a1', ['See this photo from the Claude app please'], '06:59:00.000'),
        agentRow('a2a2a2a2', 'Got the photo.', '06:59:05.000'),
        userRow('a3a3a3a3', ['Two photos here, what do you think'], '06:59:30.000'),
        agentRow('a4a4a4a4', 'Seen both.', '06:59:35.000')
      ]
      await show('07:00:00.000', { messages: app, screen })
      await send('07:00:18.000', 'pasted in the terminal', ['file:///phone/one.jpg'])
      const sent = frames.length
      const landed = [...app, promptRow('b1b1b1b1', 1, 1, 'pasted in the terminal', '07:00:19.716'), companionRow('b2b2b2b2', PATHS1.slice(0, 1), '07:00:19.716')]
      await show('07:00:20.000', { messages: landed, working: true, screen })
      for (const frame of framesFrom(sent)) {
        expect(drawing(frame, 'pasted in the terminal')).toEqual([expect.objectContaining({ images: 'P' })])
      }
      expect(lastFrame()).toEqual([
        { id: 'a1a1a1a1', images: 'D', text: 'See this photo from the Claude app please' },
        { id: 'a3a3a3a3', images: 'DD', text: 'Two photos here, what do you think' },
        { id: 'b1b1b1b1', images: 'P', text: 'pasted in the terminal' }
      ])
    })
  })

  // 967668df lines 23712 to 23724: sent while Claude worked, enqueued at
  // 07:03:54.573, taken at 07:04:35.191 and written only as a `queued_command`
  // attachment, with no user row and no image companion at all.
  describe('sent while Claude worked', () => {
    const TEXT3 = 'Images shown as preview and shown as images on desktop too fix'
    const working = [...before, P2, C2, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
    const tookIt = [...working, agentRow('33806c18', 'Spawning a fixer.', '07:04:32.916')]
    const ended = [...tookIt, agentRow('a392b851', 'Done.', '07:05:12.454')]

    it('draws a photo message Claude took mid-turn once, as the phone’s pictures, in every frame', async () => {
      vi.setSystemTime(at('07:03:20.000'))
      await show('07:03:20.000', { messages: working, working: true })
      await send('07:03:54.000', TEXT3, ['file:///phone/c1.jpg'])
      const sent = frames.length
      const prompts = hookCopy('07:03:54.573', `[Image #73] ${TEXT3}`)
      const box = queuedMessagesFromScreen(claudeScreen([`[Image #73] ${TEXT3}`]))
      await show('07:03:55.000', { messages: working, working: true, prompts, queued: box })
      await show('07:04:36.000', { messages: tookIt, working: true, prompts, queued: [] })
      await show('07:05:13.000', { messages: ended, prompts, queued: [] })
      for (const frame of framesFrom(sent)) {
        expect(frame.filter((bubble) => bubble.id !== 'e96491cb' && bubble.images.includes('D'))).toEqual([])
        expect(drawing(frame, TEXT3).length).toBeLessThanOrEqual(1)
      }
      expect(drawing(lastFrame(), TEXT3)).toEqual([expect.objectContaining({ images: 'P' })])
    })

    // The companion is the last row for the seconds before the agent writes
    // anything (23624 at 07:00:19.716, the first reply row at 07:00:37.425).
    it('draws a message sent just after a photo message under it, where it was sent', async () => {
      const TEXT5 = 'and check the queue box too'
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await show('07:00:20.000', { messages: [...before, P1, C1], working: true })
      await send('07:00:25.000', TEXT5, [])
      const box = queuedMessagesFromScreen(claudeScreen([TEXT5]))
      await show('07:00:26.000', { messages: [...before, P1, C1], working: true, queued: box })
      const thinking = [...before, P1, C1, agentRow('2af316a2', 'Checking the roster.', '07:00:39.183')]
      await show('07:00:40.000', { messages: thinking, working: true, queued: [] })
      const order = (frames.at(-1)!.folded as NativeChatMessage[]).map((message) => message.id)
      const { data } = buildMobileNativeChatTransientData({
        messages: thinking,
        folded: frames.at(-1)!.folded as NativeChatMessage[],
        streaming: null,
        pending: frames.at(-1)!.pending as never
      })
      expect(order).toEqual(['94b09904', '40b55aba', '2af316a2'])
      expect(data.map((message) => (message.id.startsWith('pending-') ? 'phone' : message.id))).toEqual([
        '94b09904',
        '40b55aba',
        'phone',
        '2af316a2'
      ])
    })

    // 967668df lines 22342 to 22347: enqueued at 00:22:26.117, still queued
    // when the turn ended, dequeued as a `user` row with promptSource
    // "queued" and its image companion right after it.
    it('draws a photo message Claude dequeued at the end of the turn once, as the phone’s pictures, in every frame', async () => {
      const TEXT4 = 'The running taks keep changing so fast see whats happening and fix that'
      vi.setSystemTime(at('07:03:20.000'))
      await show('07:03:20.000', { messages: working, working: true })
      await send('07:03:54.000', TEXT4, ['file:///phone/d1.jpg'])
      const sent = frames.length
      const box = queuedMessagesFromScreen(claudeScreen([`[Image #64] ${TEXT4}`]))
      await show('07:03:55.000', { messages: working, working: true, queued: box })
      await show('07:05:12.900', { messages: ended, working: true, queued: box })
      const dequeued = [
        ...ended,
        promptRow('1f8a4dde', 64, 1, TEXT4, '07:05:13.195'),
        companionRow('9c8f4984', ['orca-paste-1790382128170-0b4785da-e9ad-4b2e-8ee7-828189c7a0ad'], '07:05:13.195')
      ]
      await show('07:05:13.300', { messages: dequeued, working: true, queued: [] })
      await show('07:05:14.000', { messages: dequeued, working: true, queued: [] })
      for (const frame of framesFrom(sent)) {
        expect(frame.filter((bubble) => bubble.id !== 'e96491cb' && bubble.images.includes('D'))).toEqual([])
        expect(drawing(frame, TEXT4).length).toBeLessThanOrEqual(1)
      }
      expect(drawing(lastFrame(), TEXT4)).toEqual([{ id: '1f8a4dde', images: 'P', text: words(TEXT4) }])
    })
  })

  // Codex CLI 0.153.4 writes a pasted photo on the user row itself, as a
  // `local_image` with the host path beside the `[Image #1]` in the words
  // (rollout 01a07632-429d, 2026-09-06, ordinal 269), which Orca's reader turns
  // into an image block with that path.
  // Review of becd6af2 (2026-09-26), each probe failing on it.
  describe('what the review of the path rule found', () => {
    const reply2 = agentRow('r2r2r2r2', 'Both photos seen.', '07:00:40.000')

    // The tail page can start between a photo prompt and its companion. The
    // chat keeps that companion on its own (keepWindowStartRun); the binder
    // folded it into the next prompt, whose path rule then took the first
    // message's photos for it.
    it('draws the second photo message with its own photos when the chat comes back on a window that starts at the first one’s companion', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await send('07:00:19.000', TEXT2, PHOTOS2)
      act(() => renderer?.unmount())
      renderer = null
      const back = frames.length
      const P2b = promptRow('e96491cb', 70, 3, TEXT2, '07:00:20.100')
      const C2b = companionRow('394fac0f', PATHS2, '07:00:20.100')
      await show('07:05:00.000', { messages: [C1, P2b, C2b, reply2] })
      for (const frame of framesFrom(back)) {
        expect(drawing(frame, TEXT2)).toEqual([expect.objectContaining({ images: 'PPP' })])
      }
      const drawn = frames.at(-1)!.imagePreviewsByMessageId as Record<string, string[]>
      expect(drawn['e96491cb']).toEqual(PHOTOS2)
    })

    it('never hands a photo pasted at the desk the phone’s photos when the window starts at a phone photo’s companion', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      act(() => renderer?.unmount())
      renderer = null
      const desk = promptRow('deskdesk', 70, 1, 'pasted at the desk', '07:00:20.100')
      const deskCompanion = companionRow('deskcomp', PATHS2.slice(0, 1), '07:00:20.100')
      await show('07:05:00.000', { messages: [C1, desk, deskCompanion, reply2] })
      expect(drawing(lastFrame(), 'pasted at the desk')).toEqual([{ id: 'deskdesk', images: 'D', text: 'pasted at the desk' }])
    })

    // The store had not read the send back when the chat came back, and the
    // waiting copy of a send made before the read settled was skipped.
    it.each([
      ['with no words', ''],
      ['with words', 'what is this']
    ])('keeps the phone’s photo in the first frame back, for a photo %s sent before the read settled whose row landed while away', async (_label, body) => {
      const earlier = [agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000')]
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: earlier, loading: true })
      await send('09:30:03.500', body, ['file:///phone/p17.jpg'])
      act(() => renderer?.unmount())
      renderer = null
      await act(async () => {
        await Promise.resolve()
      })
      const back = frames.length
      const mine = promptRow('add90135', 17, 1, body, '09:30:03.923')
      const C17 = companionRow('344189e5', PATHS1.slice(0, 1), '09:30:03.923')
      const reply = agentRow('d4f3162c', 'Here is what the photo shows.', '09:30:13.156')
      await show('09:31:00.000', { messages: [...earlier, mine, C17, reply] })
      for (const frame of framesFrom(back)) {
        expect(frame.filter((bubble) => bubble.images.includes('D'))).toEqual([])
      }
      expect(lastFrame()).toEqual([{ id: 'add90135', images: 'P', text: body }])
    })

    // A captioned photo retired by the words of an older row, before its own
    // row landed: its photo was bound nowhere, and its row drew the chip.
    it.each([
      [
        'a photo row',
        [
          agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
          promptRow('old1old1', 16, 1, 'what about this one', '08:43:47.644'),
          companionRow('old2old2', PATHS2.slice(0, 1), '08:43:47.644'),
          agentRow('0b0bbe84', 'That one is fine.', '08:44:10.000')
        ],
        'D'
      ],
      [
        'a row of words alone',
        [
          agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
          userRow('old1old1', ['what about this one'], '08:43:47.644'),
          agentRow('0b0bbe84', 'That one is fine.', '08:44:10.000')
        ],
        ''
      ]
    ])('keeps a captioned photo sent before the read settled for its own row, when the settled read holds only %s with its words', async (_label, older, olderImages) => {
      const mine = promptRow('new1new1', 17, 1, 'what about this one', '09:30:04.300')
      const C17 = companionRow('344189e5', PATHS1.slice(0, 1), '09:30:04.300')
      vi.setSystemTime(at('09:29:00.000'))
      await show('09:29:00.000', { messages: [], loading: true })
      await send('09:30:03.500', 'what about this one', ['file:///phone/p17.jpg'])
      const sent = frames.length
      await show('09:30:03.900', { messages: older, working: true })
      await show('09:30:04.500', { messages: [...older, mine, C17], working: true })
      for (const frame of framesFrom(sent)) {
        expect(frame.filter((bubble) => bubble.id === 'new1new1' && bubble.images.includes('D'))).toEqual([])
      }
      expect(lastFrame()).toEqual([
        { id: 'old1old1', images: olderImages, text: 'what about this one' },
        { id: 'new1new1', images: 'P', text: 'what about this one' }
      ])
    })

    // A photo Claude took mid-turn has no row of its own; a later message of
    // the same words, with no photo in it, is not its row.
    it('keeps a photo Claude took mid-turn off a later row of the same words with no photo in it', async () => {
      const working = [...before, agentRow('080e05a3', 'Looking at the fold.', '07:03:19.619')]
      vi.setSystemTime(at('07:03:20.000'))
      await show('07:03:20.000', { messages: working, working: true })
      await send('07:03:54.000', 'yes', ['file:///phone/taken.jpg'], [`${TEMP}/orca-paste-1790406034000-11111111-2222-4333-8444-555555555555.png`])
      await show('07:03:55.000', { messages: working, working: true, queued: queuedMessagesFromScreen(claudeScreen(['[Image #73] yes'])) })
      const tookIt = [...working, agentRow('33806c18', 'Took it.', '07:04:32.916')]
      await show('07:04:36.000', { messages: tookIt, working: true, queued: [] })
      const ended = [...tookIt, agentRow('a392b851', 'Done.', '07:05:12.454')]
      await show('07:05:13.000', { messages: ended, queued: [] })
      await send('07:06:00.000', 'yes', [])
      await show('07:06:01.000', { messages: [...ended, userRow('yesyesye', ['yes'], '07:06:00.300')] })
      expect(lastFrame().find((bubble) => bubble.id === 'yesyesye')).toEqual({ id: 'yesyesye', images: '', text: 'yes' })
    })
  })

  // Re-review of 4e25d63e (2026-09-26), each probe failing on it.
  describe('what the re-review of the path rule found', () => {

    // An ack-lost image send ('unknown') keeps its bubble and says "Delivery
    // unconfirmed — check chat before retrying" (use-mobile-native-chat-message-
    // send.ts); its paste can sit on the input line undelivered, marked stale,
    // and the next send's leading Ctrl+U clears it. The user sends again.
      describe('a photo message sent again after its first send was never delivered', () => {
      const LOST = `${TEMP}/orca-paste-1790406010000-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`
      const AGAIN = `${TEMP}/orca-paste-1790406070000-11111111-2222-4333-8444-555555555555.png`

      it('draws the message once when the photo is attached again and sent with the same words', async () => {
        await show('07:00:00.000', { messages: before })
        await send('07:00:18.000', TEXT1, ['file:///phone/shot.jpg'], [LOST])
        await show('07:01:00.000', { messages: before })
        await send('07:01:10.000', TEXT1, ['file:///phone/shot.jpg'], [AGAIN])
        const landed = [...before, promptRow('r1r1r1r1', 67, 1, TEXT1, '07:01:10.500'), companionRow('r1c1r1c1', [AGAIN.slice(TEMP.length + 1, -4)], '07:01:10.500')]
        await show('07:01:11.000', { messages: landed, working: true })
        await show('07:01:40.000', { messages: [...landed, reply1] })
        await show('08:01:40.000', { messages: [...landed, reply1] })
        expect(drawing(lastFrame(), TEXT1)).toEqual([{ id: 'r1r1r1r1', images: 'P', text: words(TEXT1) }])
      })
    })

    describe('a photo that failed to attach', () => {
      // placedByName: "A photo of the send's that no block names (one that
      // failed to attach) still shows, after them, as the phone's." With one
      // photo that failed, its row carries the words and no photo at all.
      it('draws one bubble, with the phone’s photo, when the phone sent one photo with words and the row names none of it', async () => {
        await show('07:00:00.000', { messages: before })
        await send('07:00:18.000', TEXT1, PHOTOS1.slice(0, 1))
        const landed = [...before, userRow('e1e2e3e4', [TEXT1], '07:00:19.716')]
        await show('07:00:20.000', { messages: landed, working: true })
        await show('07:00:21.000', { messages: [...landed, reply1] })
        expect(drawing(lastFrame(), TEXT1)).toEqual([{ id: 'e1e2e3e4', images: 'P', text: words(TEXT1) }])
      })
    })

      // Claude Code before 2.1.228 wrote a photo's companion BEFORE its prompt
    // (normalizeImageTranscriptMessages: "before the prompt in older builds").
    describe('the preview migration in the older order', () => {
      it('keeps a phone photo on its prompt when the next read also holds the next photo message, in the older order', async () => {
        await show('07:00:00.000', { messages: before })
        await send('07:02:53.000', TEXT2, PHOTOS2)
        const C2o = companionRow('394fac0f', PATHS2, '07:02:54.344')
        const P2o = promptRow('e96491cb', 70, 3, TEXT2, '07:02:54.345')
        const C3o = companionRow('deskcomp', PATHS1.slice(0, 1), '07:02:56.000')
        const P3o = promptRow('deskdesk', 73, 1, 'pasted at the desk', '07:02:56.001')
        // A read between the companion and its prompt: the row that names the
        // phone's paths is the companion alone, and the send binds it.
        await show('07:02:54.400', { messages: [...before, C2o], working: true })
        await show('07:02:57.000', { messages: [...before, C2o, P2o, C3o, P3o], working: true })
        expect(lastFrame()).toEqual([
          { id: 'e96491cb', images: 'PPP', text: words(TEXT2) },
          { id: 'deskdesk', images: 'D', text: 'pasted at the desk' }
        ])
      })
    })

      describe('a captioned photo sent before the read settled that Claude took mid-turn', () => {
      it('keeps its bubble, with its photo, when the settled read holds an older row of the same words', async () => {
        const older = [
          agentRow('0a0a0a0a', 'Earlier answer.', '08:40:00.000'),
          userRow('old1old1', ['what about this one'], '08:43:47.644'),
          agentRow('0b0bbe84', 'That one is fine.', '08:44:10.000'),
          agentRow('0c0c0c0c', 'Working on the next step.', '09:29:50.000')
        ]
        vi.setSystemTime(at('09:29:00.000'))
        await show('09:29:00.000', { messages: [], loading: true, working: true })
        await send('09:30:03.500', 'what about this one', ['file:///phone/p17.jpg'])
        const box = queuedMessagesFromScreen(claudeScreen(['[Image #17] what about this one']))
        await show('09:30:04.000', { messages: older, working: true, queued: box })
        const tookIt = [...older, agentRow('33806c18', 'Took it.', '09:30:30.000')]
        await show('09:30:31.000', { messages: tookIt, working: true, queued: [] })
        await show('09:30:32.000', { messages: tookIt, working: true, queued: [] })
        expect(drawing(lastFrame(), 'what about this one')).toEqual([
          { id: 'old1old1', images: '', text: 'what about this one' },
          expect.objectContaining({ images: 'P', text: 'what about this one' })
        ])
      })
    })
  })

  it('never draws the phone’s own photo as Image on Desktop on Codex either, as its row lands', async () => {
    const codexBefore = [agentRow('msg_01a07664-a8ff', 'Models load from the agent now.', '07:00:00.500')]
    await show('07:00:01.000', { messages: codexBefore, agent: 'codex' })
    await send('07:00:18.000', 'reading models from the agent make that faster', ['file:///phone/e1.jpg'])
    const sent = frames.length
    const row: NativeChatMessage = {
      id: '01a07667-28a8-70f0-ac4b-f8acf2870802',
      role: 'user',
      blocks: [
        { type: 'image-ref', path: `${TEMP}/orca-paste-1788692837713-14c67aef-b415-4e02-af69-9b7196dbe54e.png` },
        { type: 'text', text: '[Image #1] reading models from the agent make that faster' }
      ],
      timestamp: at('07:00:19.240'),
      source: 'transcript'
    }
    await show('07:00:20.000', { messages: [...codexBefore, row], agent: 'codex', working: true })
    for (const frame of framesFrom(sent)) {
      expect(frame).toEqual([expect.objectContaining({ images: 'P' })])
    }
    expect(lastFrame()).toEqual([
      { id: '01a07667-28a8-70f0-ac4b-f8acf2870802', images: 'P', text: 'reading models from the agent make that faster' }
    ])
  })
})
