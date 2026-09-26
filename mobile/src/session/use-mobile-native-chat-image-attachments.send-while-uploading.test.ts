import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState } from '../transport/types'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  isMobileNativeChatTerminalWriteInFlight,
  releaseMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  deferred,
  failed,
  LANES,
  laneArgs,
  sentPaths,
  settle,
  uploadHost
} from './use-mobile-native-chat-image-attachments.send-while-uploading.test-support'
import {
  ok,
  SCOPE_A,
  SCOPE_B,
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

// 2026-09-26, the user: a marked-up screenshot reached the desktop without its
// marks, and the marked copy turned up later in a separate send. A send took
// only the chips whose upload had finished and left the rest for the next one,
// without a word. Send was greyed while a first upload ran, but the markup
// editor's re-upload never marked its chip, so a send tapped just after Done
// pasted the photo's original path. A send now waits for every upload it was
// tapped beside, on its own budget, and says why when one never lands.

const MARKED = 'data:image/png;base64,ZZZZ'

describe('a send tapped while a photo is still uploading', () => {
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
  beforeEach(() => {
    pick.mockReset()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it.each(LANES)(
    'sends the marked-up photo, not the original, when Send comes while markup is still saving (%s)',
    async (lane) => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const markupSave = deferred()
      const { client, pasted } = uploadHost([ok('save', '/tmp/a.png'), markupSave.promise])
      const args = laneArgs(lane, client)
      mount(args)
      await act(async () => {
        await hook!.attachImage('library')
      })

      let markup: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        markup = hook!.replaceAttachment('img-1', 'ZZZZ')
        await settle()
        sending = hook!.sendNativeChat('look')
        await settle()
      })
      // Nothing has gone yet (the bug sent the original here), and the marks are
      // on the chip at once, under the ring.
      expect(sentPaths(lane, args, pasted)).toEqual([])
      expect(args.baseSend).not.toHaveBeenCalled()
      expect(hook!.attachments).toMatchObject([
        { id: 'img-1', previewUri: MARKED, uploading: true }
      ])

      let accepted = false
      await act(async () => {
        markupSave.resolve(ok('save-2', '/tmp/a-marked.png'))
        await markup
        accepted = await sending
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a-marked.png'])
      expect(args.baseSend).toHaveBeenCalledOnce()
      expect(vi.mocked(args.baseSend).mock.calls[0]?.slice(0, 2)).toEqual(['look', [MARKED]])
      expect(hook!.attachments).toEqual([])
    }
  )

  it.each(LANES)(
    'sends a photo still on its first upload with the message, not in the next one (%s)',
    async (lane) => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise])
      const args = laneArgs(lane, client)
      mount(args)

      let attach: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        sending = hook!.sendNativeChat('look')
        await settle()
      })
      expect(hook!.attachments).toMatchObject([{ uploading: true, path: '' }])
      expect(args.baseSend).not.toHaveBeenCalled()

      let accepted = false
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        accepted = await sending
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
      expect(vi.mocked(args.baseSend).mock.calls[0]?.slice(0, 2)).toEqual([
        'look',
        ['file:///a.jpg']
      ])
      expect(hook!.attachments).toEqual([])
    }
  )

  // The degenerate send: the only thing in the box is the photo on its way.
  // Without the wait there was nothing to send but an empty line.
  it('waits for the only photo when there is no text, then sends it on its own', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const args = laneArgs('terminal', client)
    mount(args)

    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('')
      await settle()
    })
    expect(args.baseSend).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      await sending
    })
    expect(sentPaths('terminal', args, pasted)).toEqual(['/tmp/a.png'])
    expect(args.baseSend).toHaveBeenCalledExactlyOnceWith('', ['file:///a.jpg'], expect.any(Number))
  })

  it.each(LANES)(
    'says a photo did not upload, and sends nothing, when its upload fails during the send (%s)',
    async (lane) => {
      const second = deferred()
      const { client, pasted } = uploadHost([ok('save', '/tmp/a.png'), second.promise])
      const onSendError = vi.fn()
      const showToast = vi.fn()
      const args = laneArgs(lane, client, { onSendError, showToast })
      mount(args)
      pick.mockResolvedValueOnce([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      await act(async () => {
        await hook!.attachImage('library')
      })
      pick.mockResolvedValueOnce([{ base64: 'BBBB', uri: 'file:///b.jpg' }])

      let attach: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(true)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        sending = hook!.sendNativeChat('both of these')
        await settle()
      })
      let accepted = true
      await act(async () => {
        second.resolve(failed('save', 'disk full'))
        await attach
        accepted = await sending
      })

      expect(accepted).toBe(false)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith(
        'Message not sent: a photo did not upload'
      )
      // The attach path still says why, on its own channel.
      expect(showToast).toHaveBeenCalledWith('Attach failed', 1500)
      expect(sentPaths(lane, args, pasted)).toEqual([])
      expect(args.baseSend).not.toHaveBeenCalled()
      expect(args.beginImageSend).not.toHaveBeenCalled()
      // The photo that did upload is still there for the retry.
      expect(hook!.attachments).toMatchObject([{ id: 'img-1', path: '/tmp/a.png' }])
    }
  )

  it.each(LANES)(
    'says the markup was not saved, and sends nothing, when markup cannot upload during the send (%s)',
    async (lane) => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const markupSave = deferred()
      const { client, pasted } = uploadHost([ok('save', '/tmp/a.png'), markupSave.promise])
      const onSendError = vi.fn()
      const showToast = vi.fn()
      const args = laneArgs(lane, client, { onSendError, showToast })
      mount(args)
      await act(async () => {
        await hook!.attachImage('library')
      })

      let markup: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(true)
      await act(async () => {
        markup = hook!.replaceAttachment('img-1', 'ZZZZ')
        await settle()
        sending = hook!.sendNativeChat('look')
        await settle()
      })
      let accepted = true
      await act(async () => {
        markupSave.resolve(failed('save-2', 'disk full'))
        await markup
        accepted = await sending
      })

      expect(accepted).toBe(false)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith(
        'Message not sent: the markup was not saved. Send again to send the photo without it'
      )
      expect(showToast).toHaveBeenCalledExactlyOnceWith(
        'Markup not saved — the photo is still attached without it',
        1500
      )
      expect(sentPaths(lane, args, pasted)).toEqual([])
      expect(args.beginImageSend).not.toHaveBeenCalled()
      // The chip is the photo as it was, settled, so the next send takes it knowingly.
      expect(hook!.attachments).toEqual([
        expect.objectContaining({ id: 'img-1', path: '/tmp/a.png', previewUri: 'file:///a.jpg' })
      ])
      expect(hook!.attachments[0]?.uploading).toBeUndefined()

      await act(async () => {
        accepted = await hook!.sendNativeChat('look')
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png'])
    }
  )

  it('says the photo was still uploading, and keeps the text and the photo, when the upload outlasts the send', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
    })

    vi.useFakeTimers()
    let accepted = true
    try {
      const sending = hook!.sendNativeChat('look')
      // The link's own wait keeps 4 s of the 15 s for the writes; so does this one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_900)
      })
      expect(onSendError).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      accepted = await sending
    } finally {
      vi.useRealTimers()
    }
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: a photo was still uploading'
    )
    expect(pasted()).toEqual([])
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(args.beginImageSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toMatchObject([{ id: 'img-1', uploading: true }])
  })

  it('names a document that is still uploading by its file name', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///big.mp4', name: 'big.mp4' }])
    const { client } = uploadHost([deferred().promise])
    const onSendError = vi.fn()
    mount(laneArgs('terminal', client, { onSendError }))
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
    })
    vi.useFakeTimers()
    try {
      const sending = hook!.sendNativeChat('')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000)
      })
      await sending
    } finally {
      vi.useRealTimers()
    }
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: big.mp4 was still uploading'
    )
  })

  it('gives up without sending when the tab changes while the photo uploads', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const onSendError = vi.fn()
    const args = laneArgs('structured', client, { onSendError })
    mount(args)

    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    act(() => {
      renderer!.update(createElement(Harness, { args: { ...args, scopeKey: SCOPE_B } }))
    })
    let accepted = true
    await act(async () => {
      accepted = await sending
    })
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    expect(args.baseSend).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
    })
    expect(pasted()).toEqual([])
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A]).toMatchObject([
      { path: '/tmp/a.png' }
    ])
  })

  // Review, 2026-09-26: the tab switch writes no chip, so the next thing the
  // wait hears can be the upload landing, before its 100 ms beat. That wake
  // sent tab A's photo and text into tab B's terminal.
  it.each(LANES)(
    'gives up when the tab changes just before the photo lands, instead of sending it into the new tab (%s)',
    async (lane) => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const save = deferred()
      const { client, pasted } = uploadHost([save.promise])
      const onSendError = vi.fn()
      const activeHandleRef = { current: 'term-1' }
      const args = laneArgs(lane, client, { onSendError, activeHandleRef })
      mount(args)
      let attach: Promise<void> = Promise.resolve()
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
      })

      vi.useFakeTimers()
      let accepted = true
      try {
        const sending = hook!.sendNativeChat('look')
        act(() => {
          activeHandleRef.current = 'term-2'
          renderer!.update(createElement(Harness, { args: { ...args, scopeKey: SCOPE_B } }))
        })
        await act(async () => {
          save.resolve(ok('save', '/tmp/a.png'))
          await attach
          accepted = await sending
        })
      } finally {
        vi.useRealTimers()
      }
      expect(accepted).toBe(false)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
      expect(pasted()).toEqual([])
      expect(args.baseSend).not.toHaveBeenCalled()
    }
  )

  // Review, 2026-09-26: the editor's Done stays live until the flattened
  // image is read, so a quick second tap ran the markup twice. The second
  // took the first's uploading chip as the one to put back, and the chip
  // stayed uploading for good: every send waited on it, and its X and pencil
  // were hidden.
  it.each([
    [
      'lands',
      ok('save-2', '/tmp/a-marked.png'),
      { path: '/tmp/a-marked.png', previewUri: MARKED },
      0
    ],
    ['fails', failed('save-2', 'disk full'), { path: '/tmp/a.png', previewUri: 'file:///a.jpg' }, 1]
  ] as const)(
    'keeps the photo sendable when Done is tapped twice and the markup upload %s',
    async (_outcome, answer, chip, toasts) => {
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      const { client, pasted } = uploadHost([
        ok('save', '/tmp/a.png'),
        answer,
        failed('save-3', 'disk full')
      ])
      const showToast = vi.fn()
      const args = laneArgs('terminal', client, { showToast })
      mount(args)
      await act(async () => {
        await hook!.attachImage('library')
      })

      await act(async () => {
        await Promise.all([
          hook!.replaceAttachment('img-1', 'ZZZZ'),
          hook!.replaceAttachment('img-1', 'ZZZZ')
        ])
      })
      expect(hook!.attachments).toEqual([expect.objectContaining({ id: 'img-1', ...chip })])
      expect(hook!.attachments[0]?.uploading).toBeUndefined()
      const notSaved = showToast.mock.calls.filter(([message]) =>
        String(message).startsWith('Markup not saved')
      )
      expect(notSaved).toHaveLength(toasts)

      let accepted = false
      await act(async () => {
        accepted = await hook!.sendNativeChat('look')
      })
      expect(accepted).toBe(true)
      expect(sentPaths('terminal', args, pasted)).toEqual([chip.path])
    }
  )

  // Review, 2026-09-26: chips live in a module-level store and outlive the
  // composer, but each mount counted chip ids from 1 again, so a photo picked
  // after a remount took the id of one already in the strip. The wait found
  // chips by id: it pasted the new photo twice and dropped the old one.
  it.each(LANES)(
    'sends both photos when one was attached before the chat remounted and the other is still uploading (%s)',
    async (lane) => {
      const save = deferred()
      const { client, pasted } = uploadHost([ok('save', '/tmp/a.png'), save.promise])
      const args = laneArgs(lane, client)
      mount(args)
      pick.mockResolvedValueOnce([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      await act(async () => {
        await hook!.attachImage('library')
      })
      act(() => renderer!.unmount())
      mount(args)

      pick.mockResolvedValueOnce([{ base64: 'BBBB', uri: 'file:///b.jpg' }])
      let attach: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        sending = hook!.sendNativeChat('both')
        await settle()
      })
      let accepted = false
      await act(async () => {
        save.resolve(ok('save-2', '/tmp/b.png'))
        await attach
        accepted = await sending
      })
      expect(accepted).toBe(true)
      expect(sentPaths(lane, args, pasted)).toEqual(['/tmp/a.png', '/tmp/b.png'])
      expect(hook!.attachments).toEqual([])
    }
  )

  // The same count, for selections: a remount named its first selection
  // batch-1 again, so when the earlier mount's upload finished, its sweep of
  // chips left uploading took the photo the new mount was still uploading.
  it('keeps a photo on its way after the chat remounts, when a photo picked before the remount lands', async () => {
    const first = deferred()
    const second = deferred()
    const { client } = uploadHost([first.promise, second.promise])
    const args = laneArgs('terminal', client)
    mount(args)
    pick.mockResolvedValueOnce([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    let before: Promise<void> = Promise.resolve()
    await act(async () => {
      before = hook!.attachImage('library')
      await settle()
    })
    act(() => renderer!.unmount())
    mount(args)
    pick.mockResolvedValueOnce([{ base64: 'BBBB', uri: 'file:///b.jpg' }])
    let after: Promise<void> = Promise.resolve()
    await act(async () => {
      after = hook!.attachImage('library')
      await settle()
    })

    await act(async () => {
      first.resolve(ok('save', '/tmp/a.png'))
      await before
    })
    expect(hook!.attachments).toMatchObject([
      { previewUri: 'file:///a.jpg', path: '/tmp/a.png' },
      { previewUri: 'file:///b.jpg', uploading: true }
    ])
    await act(async () => {
      second.resolve(ok('save-2', '/tmp/b.png'))
      await after
    })
    expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/a.png', '/tmp/b.png'])
    expect(new Set(hook!.attachments.map((chip) => chip.id)).size).toBe(2)
  })

  // Review, 2026-09-26: the send held its terminal's write lock through the
  // wait, so a permission or question card tapped meanwhile was refused
  // ("Response not sent") on a healthy link, for as long as the photo took.
  it('leaves the terminal free for a card answer while the send waits for a photo', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const args = laneArgs('terminal', client)
    mount(args)
    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)

    let accepted = false
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      accepted = await sending
    })
    expect(accepted).toBe(true)
    expect(sentPaths('terminal', args, pasted)).toEqual(['/tmp/a.png'])
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
  })

  it('sends nothing, and keeps the photo, when a card is still writing as the photo lands', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    const card = acquireMobileNativeChatTerminalWrite('term-1')
    let accepted = true
    try {
      expect(card).toBe(true)
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        accepted = await sending
      })
    } finally {
      releaseMobileNativeChatTerminalWrite('term-1')
    }
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent')
    expect(pasted()).toEqual([])
    expect(args.beginImageSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toMatchObject([{ id: 'img-1', path: '/tmp/a.png' }])
  })

  // Review, 2026-09-26: a link that drops while a photo uploads holds the
  // upload with it, and the refusal blamed the photo instead of the link.
  it('says the link is down, not that the photo was still uploading, when the connection drops during the wait', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const link: { state: ConnectionState } = { state: 'connected' }
    const { client, pasted } = uploadHost([deferred().promise], link)
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
    })

    vi.useFakeTimers()
    let accepted = true
    try {
      const sending = hook!.sendNativeChat('look')
      link.state = 'disconnected'
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_100)
      })
      accepted = await sending
    } finally {
      vi.useRealTimers()
    }
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: not connected to your desktop'
    )
    expect(pasted()).toEqual([])
    expect(hook!.attachments).toMatchObject([{ id: 'img-1', uploading: true }])
  })

  // Second review, 2026-09-26: the link's reason goes out only when the link
  // is what is down. The input lease does not hold an upload up.
  it('says the photo was still uploading when the link is up but the desktop is not taking input yet', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const { client, pasted } = uploadHost([deferred().promise])
    const onSendError = vi.fn()
    mount(laneArgs('terminal', client, { onSendError, enabled: false }))
    await act(async () => {
      void hook!.attachImage('library')
      await settle()
    })

    vi.useFakeTimers()
    let accepted = true
    try {
      const sending = hook!.sendNativeChat('look')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_100)
      })
      accepted = await sending
    } finally {
      vi.useRealTimers()
    }
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: a photo was still uploading'
    )
    expect(pasted()).toEqual([])
  })

  // Second review, 2026-09-26: a session tab's send goes to the session, not
  // to a terminal, so its terminal handle changing is no reason to refuse it.
  it("sends a session tab's photo when the tab's terminal handle changes during the wait", async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const save = deferred()
    const { client, pasted } = uploadHost([save.promise])
    const onSendError = vi.fn()
    const activeHandleRef = { current: 'term-1' }
    const args = laneArgs('structured', client, { onSendError, activeHandleRef })
    mount(args)
    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    activeHandleRef.current = 'term-2'
    let accepted = false
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      accepted = await sending
    })
    expect(accepted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    expect(sentPaths('structured', args, pasted)).toEqual(['/tmp/a.png'])
  })

  // Second review, 2026-09-26: each mount counted chip ids from 1 again, so a
  // photo picked after a remount took the id of one a failed send was about
  // to put back, and the X on either photo took both away.
  it('removes only the photo tapped when a failed send puts one back beside a photo picked after the chat remounted', async () => {
    const { client } = uploadHost([ok('save', '/tmp/a.png'), ok('save-2', '/tmp/b.png')])
    let reject: (outcome: 'rejected') => void = () => {}
    const baseSend = vi.fn(
      () =>
        new Promise<'rejected'>((resolve) => {
          reject = resolve
        })
    )
    const args = laneArgs('structured', client, { baseSend })
    mount(args)
    pick.mockResolvedValueOnce([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    await act(async () => {
      await hook!.attachImage('library')
    })
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    expect(hook!.attachments).toEqual([])
    act(() => renderer!.unmount())
    mount(args)
    pick.mockResolvedValueOnce([{ base64: 'BBBB', uri: 'file:///b.jpg' }])
    await act(async () => {
      await hook!.attachImage('library')
    })
    await act(async () => {
      reject('rejected')
      await sending
    })
    expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/a.png', '/tmp/b.png'])
    const picked = hook!.attachments[1]!
    act(() => hook!.removeAttachment(picked.id))
    expect(hook!.attachments.map((chip) => chip.path)).toEqual(['/tmp/a.png'])
  })

  // Second review, 2026-09-26: the same photo picked twice draws two chips
  // with one picture. Whichever upload landed first filled the first chip,
  // the other pick's sweep then took the chip still waiting, and the send
  // said a photo did not upload when both had.
  it('sends a photo picked twice when the second pick lands first', async () => {
    const first = deferred()
    const second = deferred()
    const { client, pasted } = uploadHost([first.promise, second.promise])
    const onSendError = vi.fn()
    const args = laneArgs('terminal', client, { onSendError })
    mount(args)
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const picks: Promise<void>[] = []
    let sending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      picks.push(hook!.attachImage('library'))
      await settle()
      picks.push(hook!.attachImage('library'))
      await settle()
      sending = hook!.sendNativeChat('twice')
      await settle()
    })
    let accepted = false
    await act(async () => {
      second.resolve(ok('save-2', '/tmp/a2.png'))
      await picks[1]
      first.resolve(ok('save', '/tmp/a1.png'))
      await picks[0]
      accepted = await sending
    })
    expect(onSendError).not.toHaveBeenCalled()
    expect(accepted).toBe(true)
    expect(sentPaths('terminal', args, pasted)).toEqual(['/tmp/a1.png', '/tmp/a2.png'])
  })
})
