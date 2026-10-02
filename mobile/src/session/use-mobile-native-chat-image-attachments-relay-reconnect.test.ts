import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
// The import inside the factory is forced: vi.mock is hoisted above every
// static import, so the factory cannot reach one.
vi.mock('../transport/mobile-relay-e2ee-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport/mobile-relay-e2ee-link')>()),
  MobileRelayE2eeLink: (await import('../transport/relay-desktop-fake-link')).FakeRelayLink
}))

import { fakeRelayLinks, resetFakeRelayLinks } from '../transport/relay-desktop-fake-link'
import {
  acceptRelayDial,
  dropRelayLink,
  openRelayOnlyPhone,
  type RelayOnlyPhone
} from '../transport/relay-desktop-test-fakes'
import { useRelayChatTabGate } from '../test-support/relay-chat-tab-gate'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import {
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'

// The image half of the 2026-09-25 report ("message not send disconnected"):
// a photo, or a text send that first heals an orphaned paste, tapped while
// the relay re-dials. Every gate in the image hook refused at once, and it
// refused before the composer emptied, so a wait that ends the same way must
// leave the text, the chips and the absent bubble exactly as they were.

const SCOPE = 'h\0w\0tab-a'
const OTHER_SCOPE = 'h\0w\0tab-b'
const CHIP = { id: 'img-1', path: '/tmp/a.png', previewUri: 'file:///a.jpg' }

type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>

describe('a photo sent while the relay re-dials', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  let gate: ReturnType<typeof useRelayChatTabGate> | null = null
  let phone: RelayOnlyPhone | null = null
  const onSendError = vi.fn()
  const undoBegin = vi.fn()
  const beginImageSend = vi.fn((): (() => void) => undoBegin)
  const baseSend = vi.fn(async () => 'accepted' as const)

  function Probe({
    client,
    structured,
    scopeKey = SCOPE
  }: {
    client: RelayOnlyPhone['logical']
    structured: boolean
    scopeKey?: string
  }): null {
    gate = useRelayChatTabGate(client, 'term')
    hook = useMobileNativeChatImageAttachments({
      agent: 'claude',
      client,
      activeHandleRef: { current: 'term' },
      deviceTokenRef: { current: 'device-token' },
      getActiveWorktreeConnectionId: async () => null,
      connState: gate.connState,
      scopeKey,
      // As use-mobile-session-image-attachments.ts builds it for each lane.
      enabled: structured ? gate.connState === 'connected' : gate.leaseReady,
      structuredNativeChat: structured,
      refuseUnderDialog: readSendUnderDialogRefusal,
      showToast: vi.fn(),
      onSendError,
      baseSend,
      beginImageSend,
      readSeededLaunchDraft: () => null,
      sleep: async () => {}
    })
    return null
  }

  /** React applies a state update only when an act ends, so a poll inside
   *  one never sees it; let fake time pass in short acts instead. */
  async function until(check: () => boolean, stepMs = 10): Promise<void> {
    for (let step = 0; step < 500 && !check(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs)
      })
    }
    expect(check()).toBe(true)
  }

  async function openConnectedChat(structured: boolean): Promise<RelayOnlyPhone> {
    const opened = openRelayOnlyPhone()
    await acceptRelayDial(opened, 0)
    await opened.started
    act(() => {
      renderer = create(createElement(Probe, { client: opened.logical, structured }))
    })
    await until(() => gate?.sendable === true)
    return opened
  }

  async function desktopLegDrops(): Promise<void> {
    await act(async () => {
      dropRelayLink(fakeRelayLinks[0]!, 4408)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(gate?.connState).toBe('disconnected')
  }

  function terminalWrites(index: number): string[] {
    return fakeRelayLinks[index]!.sent('terminal.send').map((frame) =>
      String(frame.params?.text ?? '')
    )
  }

  function seedChip(): void {
    useNativeChatImageAttachmentsStore.getState().update(() => ({ [SCOPE]: [CHIP] }))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
    vi.clearAllMocks()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    gate = null
    phone?.supervisor.stop()
    phone?.logical.close()
    phone = null
    vi.useRealTimers()
  })

  it('pastes the photo and sends its caption once the replacement relay and the lease are back', async () => {
    phone = await openConnectedChat(false)
    seedChip()
    await desktopLegDrops()

    let sent: boolean | null = null
    void hook!.sendNativeChat('look').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSendError).not.toHaveBeenCalled()
    // The box has not emptied and no bubble is up while nothing can go out.
    expect(beginImageSend).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => sent !== null)

    expect(sent).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    expect(terminalWrites(0)).toEqual([])
    expect(terminalWrites(1).some((text) => text.includes('/tmp/a.png'))).toBe(true)
    expect(beginImageSend).toHaveBeenCalledOnce()
    expect(baseSend).toHaveBeenCalledOnce()
    expect(hook!.attachments).toEqual([])
  }, 30_000)

  it('keeps the chip and the text, with no bubble, and says why, when the relay never comes back', async () => {
    phone = await openConnectedChat(false)
    seedChip()
    await desktopLegDrops()

    let sent: boolean | null = null
    void hook!.sendNativeChat('look').then((result) => {
      sent = result
    })
    await until(() => sent !== null, 100)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
    expect(beginImageSend).not.toHaveBeenCalled()
    expect(baseSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toEqual([CHIP])
    for (const index of fakeRelayLinks.keys()) {
      expect(terminalWrites(index)).toEqual([])
    }
  }, 30_000)

  it('sends a structured session photo once the link is back', async () => {
    phone = await openConnectedChat(true)
    seedChip()
    await desktopLegDrops()

    let sent: boolean | null = null
    void hook!.sendNativeChat('look').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSendError).not.toHaveBeenCalled()
    expect(beginImageSend).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => sent !== null)

    expect(sent).toBe(true)
    expect(beginImageSend).toHaveBeenCalledOnce()
    expect(baseSend).toHaveBeenCalledWith('look', [CHIP.previewUri], expect.any(Number), [CHIP])
  }, 30_000)

  it('does not send a structured photo from the tab the user switched away from during the wait', async () => {
    phone = await openConnectedChat(true)
    seedChip()
    await desktopLegDrops()

    let sent: boolean | null = null
    void hook!.sendNativeChat('look').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // The composer now belongs to another tab; the controller's one structured
    // lane would carry this photo into that tab's session.
    act(() => {
      renderer!.update(
        createElement(Probe, { client: phone!.logical, structured: true, scopeKey: OTHER_SCOPE })
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => sent !== null)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    expect(beginImageSend).not.toHaveBeenCalled()
    expect(baseSend).not.toHaveBeenCalled()
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE]).toEqual([CHIP])
  }, 30_000)

  it('heals an orphaned paste and sends the text once the link is back', async () => {
    phone = await openConnectedChat(false)
    markMobileNativeChatInputStale('term')
    await desktopLegDrops()

    let sent: boolean | null = null
    void hook!.sendNativeChat('hello').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSendError).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => sent !== null)

    expect(sent).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    // The heal's clear went on the new socket, then the text body.
    expect(terminalWrites(1).length).toBeGreaterThan(0)
    expect(baseSend).toHaveBeenCalledWith('hello', undefined, expect.any(Number), undefined, expect.objectContaining({ terminal: 'term', reminted: false }))
  }, 30_000)
})
