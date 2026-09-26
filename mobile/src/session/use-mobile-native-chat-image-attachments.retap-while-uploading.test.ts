import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import {
  isMobileNativeChatTerminalWriteInFlight,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  deferred,
  laneArgs,
  sentPaths,
  settle,
  uploadHost
} from './use-mobile-native-chat-image-attachments.send-while-uploading.test-support'
import {
  ok,
  SCOPE_A,
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

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

// A send that waits for a photo can outlive the chat that tapped it: the chat
// remounts, draws Send live again beside the same text and photo, and takes
// another tap. The same message tapped again, trailing spaces aside, is that
// send. A different message tapped during the wait, or one with a photo added
// since, is refused and kept, and one tapped once the wait is over gets what
// it would have got with no wait at all (2026-09-26 reviews).

describe('Send tapped again while a photo message waits', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }
  function mount(args: HookArgs): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }
  function remount(args: HookArgs): void {
    act(() => renderer!.unmount())
    mount(args)
  }
  beforeEach(() => {
    pick.mockReset()
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  const texts = (args: HookArgs): string[] =>
    vi.mocked(args.baseSend).mock.calls.map((call) => call[0])

  // A chat that remounts while the send waits draws Send live again beside the
  // same text and photo. A tap there sent the message twice on a session tab,
  // which has no terminal to lock, and on a terminal said "Message not sent"
  // about a message that went. A photo sent with no text is the same message
  // with nothing to compare but the empty text.
  it.each([
    ['terminal', 'look'],
    ['structured', 'look'],
    ['structured', '']
  ] as const)(
    'sends the message once when Send is tapped again in a remounted chat while the photo uploads (%s, %j)',
    async (lane, text) => {
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise])
      const onSendError = vi.fn()
      const activeHandleRef = { current: lane === 'terminal' ? 'term-1' : null }
      const args = laneArgs(lane, client, { onSendError, activeHandleRef })
      mount(args)
      let attach: Promise<void> = Promise.resolve()
      let first: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        first = hook!.sendNativeChat(text)
        await settle()
      })
      remount(args)
      let second: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        second = hook!.sendNativeChat(text)
        await settle()
      })

      let outcomes: boolean[] = []
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        outcomes = await Promise.all([first, second])
      })
      expect(outcomes).toEqual([true, true])
      expect(onSendError).not.toHaveBeenCalled()
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
      expect(texts(args)).toEqual([text])
      expect(hook!.attachments).toEqual([])
    }
  )

  // Fourth review, 2026-09-26: the join compared the text exactly, so a
  // trailing space from the keyboard made the same message "not sent" while
  // it went, and the draft store, which compares it trimmed
  // (draftWasSent), then emptied the box under that toast.
  it.each([
    ['terminal', 'look', 'look '],
    ['structured', 'look', 'look '],
    ['structured', '', ' ']
  ] as const)(
    'sends the message once when Send is tapped again with a trailing space in a remounted chat while the photo uploads (%s, %j then %j)',
    async (lane, text, retap) => {
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise])
      const onSendError = vi.fn()
      const activeHandleRef = { current: lane === 'terminal' ? 'term-1' : null }
      const args = laneArgs(lane, client, { onSendError, activeHandleRef })
      mount(args)
      let attach: Promise<void> = Promise.resolve()
      let first: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        first = hook!.sendNativeChat(text)
        await settle()
      })
      remount(args)
      let second: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        second = hook!.sendNativeChat(retap)
        await settle()
      })
      expect(onSendError).not.toHaveBeenCalled()

      let outcomes: boolean[] = []
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        outcomes = await Promise.all([first, second])
      })
      expect(outcomes).toEqual([true, true])
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
      expect(texts(args)).toEqual([text])
    }
  )

  // Third review, 2026-09-26: a different message tapped during the wait
  // joined the first send and read as sent, though only the first message
  // went. It cannot go first, and going after would send the photo twice.
  it.each([
    ['terminal', 'look', 'look, and the second line'],
    ['structured', 'look', 'look, and the second line'],
    ['structured', '', 'look']
  ] as const)(
    'says a different message tapped in a remounted chat was not sent while the photo before it uploads (%s, %j then %j)',
    async (lane, text, other) => {
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise])
      const onSendError = vi.fn()
      const activeHandleRef = { current: lane === 'terminal' ? 'term-1' : null }
      const args = laneArgs(lane, client, { onSendError, activeHandleRef })
      mount(args)
      let attach: Promise<void> = Promise.resolve()
      let first: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        first = hook!.sendNativeChat(text)
        await settle()
      })
      remount(args)
      const outcome: { second?: boolean } = {}
      await act(async () => {
        void hook!.sendNativeChat(other).then((accepted) => {
          outcome.second = accepted
        })
        await settle()
      })
      // At the tap, out loud, with the photo still uploading.
      expect(outcome.second).toBe(false)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith(
        'Message not sent: the last message is still waiting for a photo'
      )

      let accepted = false
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        accepted = await first
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
      expect(texts(args)).toEqual([text])
    }
  )

  // Fourth review, 2026-09-26: the join matched the text alone, so a photo
  // picked in the remounted chat before the second tap was left in the strip
  // while that tap read as sent.
  it.each([
    ['terminal', 'look'],
    ['structured', 'look'],
    ['structured', '']
  ] as const)(
    'says a message tapped with a photo added in a remounted chat was not sent while the photo before it uploads (%s, %j)',
    async (lane, text) => {
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise, ok('save', '/tmp/b.png')])
      const onSendError = vi.fn()
      const activeHandleRef = { current: lane === 'terminal' ? 'term-1' : null }
      const args = laneArgs(lane, client, { onSendError, activeHandleRef })
      mount(args)
      let attach: Promise<void> = Promise.resolve()
      let first: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        first = hook!.sendNativeChat(text)
        await settle()
      })
      remount(args)
      pick.mockResolvedValueOnce([{ base64: 'BBBB', uri: 'file:///b.jpg' }])
      await act(async () => {
        await hook!.attachImage('library')
      })
      const added = hook!.attachments.find((chip) => chip.path === '/tmp/b.png')
      expect(added).toBeDefined()
      const outcome: { second?: boolean } = {}
      await act(async () => {
        void hook!.sendNativeChat(text).then((accepted) => {
          outcome.second = accepted
        })
        await settle()
      })
      expect(outcome.second).toBe(false)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith(
        'Message not sent: the last message is still waiting for a photo'
      )

      let accepted = false
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        accepted = await first
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
      expect(texts(args)).toEqual([text])
      // The added photo stays for the next send, as the toast said.
      expect(hook!.attachments.map((chip) => chip.id)).toEqual([added!.id])
    }
  )

  // Third review, 2026-09-26: a send that had waited kept a second tap joined
  // to it for as long as its delivery ran, so a new message from a remounted
  // session chat read as sent and never went.
  it('sends a new message from a remounted session chat while the photo message before it is still on its way', async () => {
    const save = deferred()
    const { client } = uploadHost([save.promise])
    const onSendError = vi.fn()
    const delivery: { deliver: (outcome: 'accepted') => void } = { deliver: () => {} }
    const baseSend = vi
      .fn<HookArgs['baseSend']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            delivery.deliver = resolve
          })
      )
      .mockResolvedValue('accepted')
    const args = laneArgs('structured', client, {
      onSendError,
      baseSend,
      activeHandleRef: { current: null }
    })
    mount(args)
    let attach: Promise<void> = Promise.resolve()
    let first: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      first = hook!.sendNativeChat('look')
      await settle()
    })
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      await vi.waitFor(() => expect(texts(args)).toEqual(['look']))
    })
    // The photo's message is with the session, and the strip is empty.
    expect(hook!.attachments).toEqual([])

    remount(args)
    const outcome: { second?: boolean } = {}
    await act(async () => {
      void hook!.sendNativeChat('a second message').then((accepted) => {
        outcome.second = accepted
      })
      await settle()
    })
    expect(texts(args)).toEqual(['look', 'a second message'])
    expect(outcome.second).toBe(true)

    let accepted = false
    await act(async () => {
      delivery.deliver('accepted')
      accepted = await first
    })
    expect(accepted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
  })

  // Third review, 2026-09-26: on a terminal the same join swallowed a tap
  // while the photo's message was being written. With no wait, the terminal's
  // lock refuses that tap and says so.
  it('says "Message not sent" for a message tapped while the photo message before it is being written, as it does with no wait', async () => {
    const save = deferred()
    const writes = { open: (): void => {} }
    const held = new Promise<void>((resolve) => {
      writes.open = resolve
    })
    const { client, pasted } = uploadHost([save.promise], undefined, async () => {
      await held
      return sendResult(true)
    })
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    let attach: Promise<void> = Promise.resolve()
    let first: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      first = hook!.sendNativeChat('look')
      await settle()
    })
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      await vi.waitFor(() => expect(pasted()).toHaveLength(1))
    })
    // The photo's message holds the terminal while its first write is out.
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(true)

    remount(args)
    const outcome: { second?: boolean } = {}
    await act(async () => {
      void hook!.sendNativeChat('a second message').then((accepted) => {
        outcome.second = accepted
      })
      await settle()
    })
    expect(outcome.second).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent')

    let accepted = false
    await act(async () => {
      writes.open()
      accepted = await first
    })
    expect(accepted).toBe(true)
    expect(sentPaths('terminal', args, pasted)).toEqual(['/tmp/a.png'])
    expect(texts(args)).toEqual(['look'])
  })

  // Third review, 2026-09-26: the store's reset left the waiting send's entry
  // behind, so in a suite that resets the store between cases every later
  // send on that tab joined a send the reset had cut off, text-only or not.
  it('sends a message tapped right after the attachment store resets, instead of joining a send the reset cut off', async () => {
    const { client } = uploadHost([deferred().promise])
    const args = laneArgs('terminal', client)
    mount(args)
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
      void hook!.sendNativeChat('look')
      await settle()
    })

    let accepted = false
    await act(async () => {
      useNativeChatImageAttachmentsStore.getState().reset()
      accepted = await hook!.sendNativeChat('hello')
    })
    expect(accepted).toBe(true)
    expect(texts(args)).toEqual(['hello'])
  })

  // Fourth review, 2026-09-26: a reset starts the chip ids again, so a photo
  // put in the strip right after one took the id of the chip a cut-off send
  // was waiting on, and that send took the new photo with the old text.
  it('sends nothing from a send the attachment store reset cut off, when the next photo takes its chip id', async () => {
    const { client, pasted } = uploadHost([deferred().promise])
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    let cutOff: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
      cutOff = hook!.sendNativeChat('look')
      await settle()
    })
    expect(hook!.attachments.map((chip) => chip.id)).toEqual(['img-1'])

    let accepted = true
    await act(async () => {
      const store = useNativeChatImageAttachmentsStore.getState()
      store.reset()
      store.update(() => ({
        // The same photo picked again, as it looks once its upload lands.
        [SCOPE_A]: [{ id: 'img-1', path: '/tmp/b.png', previewUri: 'file:///a.jpg' }]
      }))
      accepted = await cutOff
    })
    expect(accepted).toBe(false)
    expect(pasted()).toEqual([])
    expect(texts(args)).toEqual([])
  })
})
