// Reported 2026-10-09 from the phone (a main build of about 13:55, Claude Code 2.1.295,
// a terminal Claude chat tab on a macOS host): photos and a caption were sent from the chat
// composer, the user bubble drew the photos and the words, the words left the box, and the
// photos stayed in the composer's attachment row, each with its ×.
//
// The chips live in a store that outlives the chat screen; the words and the bubble lived
// only in the screen's own draft store. A send that outlived a remount of the screen and was
// then refused put the chips back into the new screen, and its words and its bubble into the
// old one, which was gone: the new screen showed no words, the stored bubble, and the photos.
//
// These drive the REAL draft store, the REAL message send and the REAL image hook together,
// against a stand-in for Claude's input whose screens are MODELLED on the `[Image #N]` chip
// literal (see mobile-native-chat-submit-verify-photos.test.ts for its provenance).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { baseArgs, methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

const RULE = '─'.repeat(190)
const BELOW = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const CAPTION = 'why does the queue box overlap the composer here'
const chips = (n: number): string => Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join('')
const inputHolding = (n: number): string[] => ['⏺ Done.', RULE, `❯ ${chips(n)}`.trimEnd(), RULE, BELOW]
const sentRow = (n: number, caption: string): string[] => [
  `❯ ${chips(n)} ${caption}`.trimEnd(), '⏺ Looking.', RULE, '❯ ', RULE, BELOW
]

/** What the desktop does with the write that carries the caption and its Enter. */
type EnterOutcome = 'submits' | 'host-refuses' | 'ack-lost'

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
type Images = ReturnType<typeof useMobileNativeChatImageAttachments>

describe('the photos of a sent message leave the composer with its text', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let images: Images | null = null
  let picks = 0
  /** Held before the box empties: the caption mirror's drain (beforeImagePaste). */
  let beforeTheBoxEmpties: Promise<void> = Promise.resolve()

  beforeEach(() => {
    pick.mockReset()
    picks = 0
    beforeTheBoxEmpties = Promise.resolve()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    images = null
    await clearNativeChatDraftStores()
  })

  /** A desktop Claude tab: photos paste into its input as chips, then the caption and its
   *  Enter go, held at `enterGate` until the test opens it. */
  function desktop(photos: number, onEnter: EnterOutcome = 'submits', enterGate?: Promise<void>) {
    let uploads = 0
    let pasted = 0
    let typed = ''
    let entered = false
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
        if (method === 'terminal.send') {
          if (params.enter === true) {
            await enterGate
            if (onEnter === 'host-refuses') {
              return ok('s', { send: { accepted: false } })
            }
            typed = params.text ?? ''
            entered = true
            if (onEnter === 'ack-lost') {
              throw markRpcDeliveryUnknown(new Error('response timed out'))
            }
          } else if ((params.text ?? '').includes('.png')) {
            pasted += 1
          }
          return ok('s', { send: { accepted: true } })
        }
        if (method === 'terminal.read') {
          const tail = entered ? sentRow(photos, typed) : inputHolding(Math.min(pasted, photos))
          return ok('r', { terminal: { source: 'screen', tail, draft: '' } })
        }
        // Each upload asks for a streamed start (unsupported here), then saves whole.
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/orca-paste-${uploads}.png`)
      })
    }
    return client as unknown as RpcClient
  }

  /** The chat screen: its draft store, its message send and its image hook, as the session
   *  route mounts them together. */
  function mount(client: RpcClient): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: [],
        transcriptSettled: true
      })
      const send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: null },
        agentRef: { current: 'claude' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError: vi.fn()
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          hostTerminalOfTab: () => 'term-1',
          beforeImagePaste: () => beforeTheBoxEmpties,
          beginImageSend: drafts.clearDraftAtSendStart,
          // What controller.handleNativeChatSendWithOutcome hands on: the follow is the 5th argument.
          baseSend: (text, previews, deadline, _attachments, follow) =>
            send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  /** The chat screen torn down and mounted again, as leaving and coming back does. */
  function remount(client: RpcClient): void {
    act(() => renderer?.unmount())
    renderer = null
    mount(client)
  }

  /** One pick of `photos` photos, uploaded; under fake timers when a send is out. */
  async function attach(photos: number, faked = false): Promise<void> {
    picks += 1
    const batch = picks
    pick.mockResolvedValueOnce(
      Array.from({ length: photos }, (_, n) => ({ base64: 'AAAA', uri: `file:///phone/pick${batch}-${n}.jpg` }))
    )
    if (faked) {
      await act(async () => {
        const attaching = images!.attachImage('library')
        await vi.advanceTimersByTimeAsync(0)
        await attaching
      })
      return
    }
    await act(async () => {
      await images!.attachImage('library')
    })
  }

  async function type(text: string): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    // The draft store writes the box to disk on a trailing debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
  }

  /** Steps the clock until the composer's chips have gone, as they do when the box empties. */
  async function untilTheChipsLeave(): Promise<void> {
    for (let step = 0; step < 300 && images!.attachments.length > 0; step += 1) {
      await advance(10)
    }
    expect(images!.attachments).toEqual([])
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  /** Taps Send and lets the whole send run out; `during` runs while it is out, each of its
   *  steps committed as the app commits them (a remount's effects run before the send goes on). */
  async function tapSend(text: string, during?: () => Promise<void>): Promise<boolean> {
    vi.useFakeTimers()
    let sending: Promise<boolean> | null = null
    await act(async () => {
      sending = images!.sendNativeChat(text)
      await vi.advanceTimersByTimeAsync(0)
    })
    await during?.()
    await advance(30_000)
    const sent = await sending!
    vi.useRealTimers()
    await act(async () => {
      await Promise.resolve()
    })
    return sent
  }

  function gate(): { gate: Promise<void>; open: () => void } {
    let open = (): void => {}
    const held = new Promise<void>((resolve) => {
      open = resolve
    })
    return { gate: held, open }
  }

  for (const photos of [1, 4]) {
    it(`clears the sent images from the composer when the message is sent (${photos} photo${photos === 1 ? '' : 's'})`, async () => {
      mount(desktop(photos))
      await attach(photos)
      await type(CAPTION)
      expect(images!.attachments).toHaveLength(photos)

      expect(await tapSend(CAPTION)).toBe(true)

      expect(drafts!.composerText).toBe('')
      expect(images!.attachments).toEqual([])
      expect(drafts!.pending).toHaveLength(1)
      expect(drafts!.pending[0]!.images).toHaveLength(photos)
    })
  }

  it('clears the photo of a photo-only send, with no words', async () => {
    mount(desktop(1))
    await attach(1)

    expect(await tapSend('')).toBe(true)

    expect(images!.attachments).toEqual([])
  })

  it('brings the images back only when the send is definitely refused', async () => {
    const refused = desktop(2, 'host-refuses')
    mount(refused)
    await attach(2)
    await type(CAPTION)

    expect(await tapSend(CAPTION)).toBe(false)

    expect(images!.attachments).toHaveLength(2)
    expect(drafts!.composerText).toBe(CAPTION)
    expect(drafts!.pending).toEqual([])
  })

  it('keeps the sent images out of the composer when the send may have gone (its ack was lost)', async () => {
    mount(desktop(2, 'ack-lost'))
    await attach(2)
    await type(CAPTION)

    expect(await tapSend(CAPTION)).toBe(true)

    expect(images!.attachments).toEqual([])
    expect(drafts!.composerText).toBe('')
  })

  for (const outcome of ['submits', 'host-refuses'] as const) {
    it(`keeps an image added while the send is in flight (${outcome === 'submits' ? 'sent' : 'refused'})`, async () => {
      const enter = gate()
      mount(desktop(2, outcome, enter.gate))
      await attach(2)
      await type(CAPTION)
      const sentIds = images!.attachments.map((chip) => chip.id)

      await tapSend(CAPTION, async () => {
        await untilTheChipsLeave()
        await attach(1, true)
        enter.open()
      })

      const left = images!.attachments.map((chip) => chip.id)
      const added = left.filter((id) => !sentIds.includes(id))
      expect(added).toHaveLength(1)
      expect(left).toEqual(outcome === 'submits' ? added : [...sentIds, ...added])
    })
  }

  it('keeps the photos, the words and the bubble together when the chat remounts while a refused send is out', async () => {
    const enter = gate()
    const client = desktop(2, 'host-refuses', enter.gate)
    mount(client)
    await attach(2)
    await type(CAPTION)

    await tapSend(CAPTION, async () => {
      await untilTheChipsLeave()
      // The emptied box reaches the disk before the screen goes.
      await advance(400)
      remount(client)
      await advance(400)
      enter.open()
    })

    expect(images!.attachments).toHaveLength(2)
    expect(drafts!.composerText).toBe(CAPTION)
    expect(drafts!.pending).toEqual([])
  })

  it('takes the words out with the photos when the chat remounts just after Send', async () => {
    const drain = gate()
    beforeTheBoxEmpties = drain.gate
    const client = desktop(2)
    mount(client)
    await attach(2)
    await type(CAPTION)

    await tapSend(CAPTION, async () => {
      // Before the box has emptied: the new screen reads the words back from disk.
      expect(images!.attachments).toHaveLength(2)
      remount(client)
      await advance(400)
      expect(drafts!.composerText).toBe(CAPTION)
      drain.open()
    })

    expect(images!.attachments).toEqual([])
    expect(drafts!.composerText).toBe('')
    expect(drafts!.pending).toHaveLength(1)
  })
})
