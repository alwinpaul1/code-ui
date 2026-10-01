import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetPhotoCopyBindingsForTests } from './desktop-prompt-photo-copies'
import { resetScreenPeerNoticesForTests } from './use-screen-peer-notices'
import { resetIdleSubmitForTests } from './desk-prompt-idle-submit'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { mergeImagePreviews } from './use-host-image-previews'
import { sentPhotosFromScreen } from './mobile-terminal-sent-photos'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import type { BeaconAgentMessage, StatusSubagentMessage } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

// The rows, photos and helpers of mobile-chat-phone-photo-landing.test.ts,
// kept here so the file of cases stays readable.

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
export const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
export const at = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
export const TEXT1 = 'Now I see 1 shell and 2 agents\n\nAlso how did this prompt you are a second reviewer got leaked in'
export const TEXT2 =
  'See images were send from my phone, but at some point it glitching and showing its from my Images from Desktop then screen flashed and showd the images preview'
export const TEMP = '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T'
export const source = (file: string) => `[Image: source: ${TEMP}/${file}.png]`
export const PATHS1 = [
  'orca-paste-1790405916218-5211776c-2f4a-4164-bbdf-ed7c7adc9c20',
  'orca-paste-1790405982176-42c80aee-6038-4de8-aa23-68dca155febb',
  'orca-paste-1790405983769-e32af309-4eb4-4934-84cd-e16bc6599062'
]
export const PATHS2 = [
  'orca-paste-1790406096684-29b46d06-37a6-424d-9a46-11a4887e13da',
  'orca-paste-1790406098133-9fa460f0-2461-4934-a1ae-c31577111f35',
  'orca-paste-1790406099541-c7ab9697-2b10-4675-b08e-3ead2f0a7d98'
]
export const PHOTOS1 = ['file:///phone/a1.jpg', 'file:///phone/a2.jpg', 'file:///phone/a3.jpg']
export const PHOTOS2 = ['file:///phone/b1.jpg', 'file:///phone/b2.jpg', 'file:///phone/b3.jpg']

export const agentRow = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
export const userRow = (id: string, texts: readonly string[], clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: texts.map((text) => ({ type: 'text' as const, text })),
  timestamp: at(clock),
  source: 'transcript'
})
/** Claude Code's prompt row for a paste: one `[Image #N]` per photo, then the words. */
export const markers = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => `[Image #${first + index}]`).join(' ')
export const promptRow = (id: string, first: number, count: number, body: string, clock: string) =>
  userRow(id, [body ? `${markers(first, count)} ${body}` : markers(first, count)], clock)
export const companionRow = (id: string, files: readonly string[], clock: string) => userRow(id, files.map(source), clock)

export const before = [agentRow('94b09904', 'One shell, two agents.', '06:58:36.593')]
export const P1 = promptRow('40b55aba', 67, 3, TEXT1, '07:00:19.716')
export const C1 = companionRow('c0153c78', PATHS1, '07:00:19.716')
export const reply1 = agentRow('cb327988', 'The reviewer prompt came from the spawn.', '07:02:23.131')
export const P2 = promptRow('e96491cb', 70, 3, TEXT2, '07:02:54.344')
export const C2 = companionRow('394fac0f', PATHS2, '07:02:54.345')

/** Orca's hook copy of a submission, as the tab status reports it: Claude's
 *  UserPromptSubmit prompt carries the `[Image #N]` markers, and puts the
 *  pane in `working` (the phone watched it arrive, so its time is the ping's). */
export function hookCopy(clock: string, body: string): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: '', updatedAt: at(clock) })
  state = observeAgentStatusPrompt(state, SESSION, { state: 'working', prompt: body, updatedAt: at(clock) })
  return [...state.prompts]
}

/** Claude Code 2.1.281's queue block above its spinner (the layout pinned in
 *  mobile-terminal-queued-messages.test.ts), holding the given rows. */
export function claudeScreen(queued: readonly string[]): string[] {
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

export type Tick = {
  /** The chat's transcript read has not settled: a kept transcript, or none. */
  loading?: boolean
  messages: NativeChatMessage[]
  working?: boolean
  prompts?: DesktopPrompt[]
  queued?: string[]
  /** Whether the screen read behind `queued` could see the agent's queue box
   *  (the controller's `nativeChatQueueReadable`); left out, it could. */
  queueReadable?: boolean
  screen?: string[]
  agent?: 'claude' | 'codex'
  /** The subagent messages the prompt beacon carried (the controller's
   *  `nativeChatAgentMessages`). */
  agentMessages?: BeaconAgentMessage[]
  /** The peer-message rows the agent's screen showed; null before the
   *  chat's first read of the screen since it began watching it. */
  peerRows?: ScreenPeerRow[] | null
  /** What the tab status carried of subagent messages (the controller's
   *  `nativeChatStatusAgentMessages`). */
  statusAgentMessages?: readonly StatusSubagentMessage[]
  /** Whether the tab was launched with the prompt hook. */
  promptHook?: boolean
  /** Rows older than `messages` exist and are not loaded (the session's
   *  `hasMore`): the chat holds a tail page. */
  hasMore?: boolean
}
export type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
/** A user bubble as the list draws it: `P` a picture, `D` the "Image on
 *  Desktop" chip, then the words. */
export type Bubble = { id: string; images: string; text: string }

export function bubblesIn(props: Record<string, unknown>): Bubble[] {
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
export const words = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The real draft store feeding the real overlay, with every render the
 *  chat list is handed: register it inside a `describe`, whose tests then
 *  send, show transcript reads, and read the frames back. `frames` is the
 *  test file's own hoisted list its MobileNativeChatView mock pushes to. */
export function landingHarness(frames: Record<string, unknown>[]) {
  let renderer: ReactTestRenderer | null = null
  // What the draft store handed the last render, read by the tests.
  const seen: { drafts: Drafts | null } = { drafts: null }
  let current: Tick = { messages: before }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(at('07:00:00.000'))
    frames.length = 0
    // Each case is its own app launch: no send pairs with a copy from another.
    resetPhotoCopyBindingsForTests()
    resetScreenPeerNoticesForTests()
    resetIdleSubmitForTests()
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    seen.drafts = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
  })

  /** The real draft store feeding the real overlay, with the host's previews
   *  not in yet: only what the phone holds can draw a picture. */
  function Route({ tick }: { tick: Tick }) {
    const drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: SESSION,
      messages: tick.messages,
      transcriptLoading: tick.loading ?? false,
      transcriptSettled: !tick.loading,
      // As the controller does: the desk prompts the chat holds.
      beaconPromptReceipts: tick.prompts
    })
    seen.drafts = drafts
    const controller = {
      showNativeChat: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: {
        messages: tick.messages,
        status: tick.loading ? 'loading' : 'ready',
        transcriptLoading: tick.loading ?? false,
        hasMore: tick.hasMore ?? false
      },
      nativeChatAgent: tick.agent ?? 'claude',
      nativeChatStructured: false,
      nativeChatAgentWorking: tick.working ?? false,
      nativeChatStreamLive: tick.working ?? false,
      nativeChatStreamScopeKey: `tab:${SESSION}`,
      nativeChatSpinner: null,
      chatPending: drafts.pending,
      chatWaitingPhotoSends: drafts.waitingPhotoSends,
      rememberEcho: drafts.rememberEcho,
      takeOwnSends: drafts.takeSends,
      nativeChatDesktopPrompts: tick.prompts,
      nativeChatQueuedMessages: tick.queued ?? [],
      nativeChatQueueReadable: tick.queueReadable ?? true,
      nativeChatScreenSentPhotos: tick.screen ? sentPhotosFromScreen(tick.screen) : [],
      nativeChatAgentMessages: tick.agentMessages ?? [],
      nativeChatScreenPeerNotices: tick.peerRows === undefined ? [] : tick.peerRows,
      nativeChatStatusAgentMessages: tick.statusAgentMessages ?? [],
      nativeChatPromptHook: tick.promptHook ?? null,
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
    const origin = seen.drafts!.captureSendOrigin(body)!
    const paths = pasted ?? (photos.length > 0 && photos.every((photo) => PASTED.has(photo)) ? photos.map((photo) => PASTED.get(photo)!) : undefined)
    await act(async () => {
      seen.drafts!.acceptSend(origin, body, [...photos], paths ? [...paths] : undefined)
    })
    await show(clock, current)
  }

  /** Every render from `from` on, as its user bubbles. */
  const framesFrom = (from: number): Bubble[][] => frames.slice(from).map(bubblesIn)
  const lastFrame = (): Bubble[] => bubblesIn(frames.at(-1)!)
  /** The bubbles in a frame that carry these words. */
  const drawing = (frame: Bubble[], body: string) => frame.filter((bubble) => bubble.text === words(body))

  return {
    show,
    send,
    framesFrom,
    lastFrame,
    drawing,
    /** The chat torn down, as leaving the project does. */
    unmount(): void {
      act(() => renderer?.unmount())
      renderer = null
    },
    drafts: (): Drafts | null => seen.drafts
  }
}
