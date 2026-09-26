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
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { sentPhotosFromScreen } from './mobile-terminal-sent-photos'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import {
  hydrateNativeChatImagePreviewCache,
  resetNativeChatImagePreviewCacheForTests
} from './mobile-native-chat-image-preview-cache'

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

// Reported from the phone on 2026-09-26 (build 12e411e3), Claude Code 2.1.281,
// session 967668df. The records are the transcript's own, 1-based lines:
//   23621 user, promptSource "typed": "[Image #67] [Image #68] [Image #69] Now I
//         see 1 shell and 2 agents…" plus three base64 image blocks, which
//         Orca's reader drops (they have no path or url)
//   23624 user, isMeta, 1 ms later: three `[Image: source: …orca-paste-….png]`
//         text blocks, which Orca 1.4.211 keeps as their own user row
//   23679 / 23682 the same for "[Image #70] [Image #71] [Image #72] See images…"
// The bubble showed the photos, then three "Image on Desktop" chips over the
// same words, then the photos again after a flash. The second message was then
// drawn with the photos AND, under it, a bubble of three chips and no words.
const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const at = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
const TEXT1 = 'Now I see 1 shell and 2 agents\n\nAlso how did this prompt you are a second reviewer got leaked in'
const TEXT2 =
  'See images were send from my phone, but at some point it glitching and showing its from my Images from Desktop then screen flashed and showd the images preview'
const TEMP = '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T'
const source = (file: string) => `[Image: source: ${TEMP}/${file}.png]`
const PATHS1 = [
  'orca-paste-1790405916218-5211776c-2f4a-4164-bbdf-ed7c7adc9c20',
  'orca-paste-1790405982176-42c80aee-6038-4de8-aa23-68dca155febb',
  'orca-paste-1790405983769-e32af309-4eb4-4934-84cd-e16bc6599062'
]
const PATHS2 = [
  'orca-paste-1790406096684-29b46d06-37a6-424d-9a46-11a4887e13da',
  'orca-paste-1790406098133-9fa460f0-2461-4934-a1ae-c31577111f35',
  'orca-paste-1790406099541-c7ab9697-2b10-4675-b08e-3ead2f0a7d98'
]
const PHOTOS1 = ['file:///phone/a1.jpg', 'file:///phone/a2.jpg', 'file:///phone/a3.jpg']
const PHOTOS2 = ['file:///phone/b1.jpg', 'file:///phone/b2.jpg', 'file:///phone/b3.jpg']

const agentRow = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
const userRow = (id: string, texts: readonly string[], clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: texts.map((text) => ({ type: 'text' as const, text })),
  timestamp: at(clock),
  source: 'transcript'
})
/** Claude Code's prompt row for a paste: one `[Image #N]` per photo, then the words. */
const markers = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => `[Image #${first + index}]`).join(' ')
const promptRow = (id: string, first: number, count: number, body: string, clock: string) =>
  userRow(id, [body ? `${markers(first, count)} ${body}` : markers(first, count)], clock)
const companionRow = (id: string, files: readonly string[], clock: string) => userRow(id, files.map(source), clock)

const before = [agentRow('94b09904', 'One shell, two agents.', '06:58:36.593')]
const P1 = promptRow('40b55aba', 67, 3, TEXT1, '07:00:19.716')
const C1 = companionRow('c0153c78', PATHS1, '07:00:19.716')
const reply1 = agentRow('cb327988', 'The reviewer prompt came from the spawn.', '07:02:23.131')
const P2 = promptRow('e96491cb', 70, 3, TEXT2, '07:02:54.344')
const C2 = companionRow('394fac0f', PATHS2, '07:02:54.345')

/** Orca's hook copy of a submission, as the tab status reports it: Claude's
 *  UserPromptSubmit prompt carries the `[Image #N]` markers. */
function hookCopy(clock: string, body: string): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  state = observeAgentStatusPrompt(state, SESSION, { prompt: '', updatedAt: at(clock) })
  state = observeAgentStatusPrompt(state, SESSION, { prompt: body, updatedAt: at(clock) })
  return [...state.prompts]
}

/** Claude Code 2.1.281's queue block above its spinner (the layout pinned in
 *  mobile-terminal-queued-messages.test.ts), holding the given rows. */
function claudeScreen(queued: readonly string[]): string[] {
  return [
    '● Running 1 shell command · 14s…',
    '',
    ...queued.map((row) => `❯ ${row}`),
    ...(queued.length ? ['  ctrl+x ctrl+s to send now'] : []),
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    `❯ ${queued.length ? 'Press up to edit queued messages' : ''}`,
    '────────────────────────────────────────────────────────────────────────────────'
  ]
}

type Tick = {
  messages: NativeChatMessage[]
  working?: boolean
  prompts?: DesktopPrompt[]
  queued?: string[]
  screen?: string[]
  agent?: 'claude' | 'codex'
}
type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
/** A user bubble as the list draws it: `P` a picture, `D` the "Image on
 *  Desktop" chip, then the words. */
type Bubble = { id: string; images: string; text: string }

function bubblesIn(props: Record<string, unknown>): Bubble[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id,
      images: message.blocks
        .map((block) => (block.type !== 'image-ref' ? '' : isDesktopImageRef(block) ? 'D' : 'P'))
        .join(''),
      text: message.blocks
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    }))
}
const words = (text: string) => text.replace(/\s+/g, ' ').trim()

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
      transcriptLoading: false,
      transcriptSettled: true
    })
    const controller = {
      showNativeChat: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: { messages: tick.messages, status: 'ready', transcriptLoading: false },
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
  async function send(clock: string, body: string, photos: readonly string[]): Promise<void> {
    vi.setSystemTime(at(clock))
    const origin = drafts!.captureSendOrigin(body)!
    await act(async () => {
      drafts!.acceptSend(origin, body, [...photos])
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
    it('keeps the phone’s photos in the first frame of a chat that comes back after their row landed while it was away', async () => {
      await show('07:00:00.000', { messages: before })
      await send('07:00:18.000', TEXT1, PHOTOS1)
      await show('07:00:19.000', { messages: before })
      act(() => renderer?.unmount())
      renderer = null
      await act(async () => {
        await Promise.resolve()
      })
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
