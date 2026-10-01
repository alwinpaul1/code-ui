import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
// The import inside the factory is forced: vi.mock is hoisted above every
// static import, so the factory cannot reach one.
vi.mock('../transport/mobile-relay-e2ee-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport/mobile-relay-e2ee-link')>()),
  MobileRelayE2eeLink: (await import('../transport/relay-desktop-fake-link')).FakeRelayLink
}))

// The desktop on the far end of this relay does not draw a Claude input, so the
// looks a Claude send takes at it are mocked away (the clear goes out unverified,
// the body is called sent). They are driven against a stand-in Claude input in
// native-chat-send-verified-clear.test.ts.
vi.mock('./mobile-native-chat-screen-read', () => ({ readMobileNativeChatScreen: () => Promise.resolve(null) }))
vi.mock('./mobile-native-chat-submit-verify', () => ({
  verifyClaudeSubmit: () => Promise.resolve({ kind: 'unverified' })
}))

import {
  fakeRelayCell,
  fakeRelayLinks,
  resetFakeRelayLinks
} from '../transport/relay-desktop-fake-link'
import {
  acceptRelayDial,
  dropRelayLink,
  openRelayOnlyPhone,
  relayDial,
  type RelayOnlyPhone
} from '../transport/relay-desktop-test-fakes'
import { useRelayChatTabGate } from '../test-support/relay-chat-tab-gate'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import type { MobileNativeChatSendOrigin } from './use-mobile-native-chat-drafts'

// Reported 2026-09-25: "sometimes when i send message i see message not send
// disconnected". The phone rides the relay at home, and a relay whose socket
// the cell closes (4408 when the desktop's leg drops) reads 'disconnected'
// until the supervisor has dialled and migrated a replacement in, usually
// within a second. A send tapped in that gap was refused at once. Everything
// under the hook here is real: the send and its terminal writes, the input
// lease, the logical client, the relay session and the supervisor.

const ORIGIN: MobileNativeChatSendOrigin = {
  draftKey: 'draft',
  draftEditGeneration: 0,
  pendingKey: 'pending',
  normalizedText: 'hello',
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true
}

type Send = ReturnType<typeof useMobileNativeChatMessageSend>

describe('a chat message sent while the relay re-dials', () => {
  let renderer: ReactTestRenderer | null = null
  let api: Send | null = null
  let gate: ReturnType<typeof useRelayChatTabGate> | null = null
  let phone: RelayOnlyPhone | null = null
  const handleRef = { current: 'term' as string | null }
  const clearDraftForSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const acceptSend = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  const onSendError = vi.fn()

  function Probe({ client }: { client: RelayOnlyPhone['logical'] }): null {
    gate = useRelayChatTabGate(client, 'term')
    api = useMobileNativeChatMessageSend({
      client,
      enabled: gate.sendable,
      handleRef,
      deviceTokenRef: { current: 'device-token' },
      agentRef: { current: 'claude' },
      commandSendRef: { current: () => {} },
      captureSendOrigin: () => ORIGIN,
      readSeededLaunchDraftSeed: () => null,
      clearDraftForSend,
      restoreRejectedDraft,
      acceptSend,
      holdUnconfirmedSend,
      onSendError
    })
    return null
  }

  /** Lets fake time pass in short acts until `check` holds: React applies a
   *  state update only when an act ends, so a poll inside one never sees it. */
  async function until(check: () => boolean, stepMs = 10): Promise<void> {
    for (let step = 0; step < 500 && !check(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs)
      })
    }
    expect(check()).toBe(true)
  }

  async function openConnectedChat(): Promise<RelayOnlyPhone> {
    const opened = openRelayOnlyPhone()
    await acceptRelayDial(opened, 0)
    await opened.started
    act(() => {
      renderer = create(createElement(Probe, { client: opened.logical }))
    })
    await until(() => gate?.sendable === true)
    return opened
  }

  /** The cell closes the phone's socket because the desktop's leg dropped. */
  async function desktopLegDrops(): Promise<void> {
    await act(async () => {
      dropRelayLink(fakeRelayLinks[0]!, 4408)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(gate?.connState).toBe('disconnected')
    expect(gate?.sendable).toBe(false)
  }

  function terminalWrites(index: number): string[] {
    return fakeRelayLinks[index]!.sent('terminal.send').map((frame) =>
      String(frame.params?.text ?? '')
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
    handleRef.current = 'term'
    vi.clearAllMocks()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
    gate = null
    phone?.supervisor.stop()
    phone?.logical.close()
    phone = null
    vi.useRealTimers()
  })

  it('goes out once the replacement relay and the input lease are back', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // Not refused: it waits for the link the supervisor is already re-dialling.
    expect(onSendError).not.toHaveBeenCalled()
    expect(sent).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => sent !== null)

    expect(sent).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    // Nothing reached the dead socket; the clear and the body went on the new one.
    expect(terminalWrites(0)).toEqual([])
    expect(terminalWrites(1)).toHaveLength(2)
    expect(terminalWrites(1)[1]).toBe('hello')
    expect(clearDraftForSend).toHaveBeenCalledOnce()
    expect(acceptSend).toHaveBeenCalledWith(ORIGIN, 'hello', undefined)
  }, 30_000)

  it('says the connection dropped and did not come back, and keeps the text, when no relay dial gets through', async () => {
    phone = await openConnectedChat()
    // Every replacement opens a socket the cell never answers.
    await desktopLegDrops()

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(sent).toBeNull()
    expect(onSendError).not.toHaveBeenCalled()
    await until(() => sent !== null, 100)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
    // Nothing was written anywhere, and the composer was never emptied, so
    // the text is still in the box to send again.
    for (const index of fakeRelayLinks.keys()) {
      expect(terminalWrites(index)).toEqual([])
    }
    expect(clearDraftForSend).not.toHaveBeenCalled()
  }, 30_000)

  it("says the desktop is offline when the cell keeps answering that it isn't attached", async () => {
    phone = await openConnectedChat()
    // HOST_OFFLINE on every replacement: the desktop's leg has not come back.
    fakeRelayCell.onOpen = (link) => dropRelayLink(link, 4404)
    await desktopLegDrops()

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await until(() => sent !== null, 100)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      "Message not sent: your desktop is offline. Check it's awake and Orca is running"
    )
    expect(clearDraftForSend).not.toHaveBeenCalled()
  }, 30_000)

  it('does not wait at all when the link is up', async () => {
    phone = await openConnectedChat()
    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await until(() => sent !== null)
    expect(sent).toBe(true)
    expect(terminalWrites(0).at(-1)).toBe('hello')
    expect(fakeRelayLinks).toHaveLength(1)
  }, 30_000)

  it('refuses at once, saying why, when an image send left its shared budget too short to wait', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    // An image send hands its own budget to the text body; three seconds is
    // less than the writes' reserve, so there is nothing left to wait with.
    let outcome: string | null = null
    await act(async () => {
      outcome = await api!.sendWithOutcome('hello', undefined, Date.now() + 3_000)
    })
    expect(outcome).toBe('rejected')
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: not connected to your desktop'
    )
  }, 30_000)

  it('does not send into another tab when the user switches during the wait', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // The link and the lease come back while the wait sleeps between looks,
    // and the user switches before its next one: the lane reads ready, but
    // the send's tab is gone.
    await act(async () => {
      await acceptRelayDial(phone!, 1)
    })
    handleRef.current = 'other-term'
    await until(() => sent !== null)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    for (const index of fakeRelayLinks.keys()) {
      expect(terminalWrites(index)).toEqual([])
    }
  }, 30_000)

  it('answers a question card at once with the reason, instead of waiting on a screen that may have moved', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()

    let answered: boolean | null = null
    await act(async () => {
      answered = await api!.answerQuestion('yes')
    })
    expect(answered).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Answer not sent: not connected to your desktop'
    )
  }, 30_000)

  it('refuses, untouched, a send whose wait woke too late to write in, and says to send again', async () => {
    phone = await openConnectedChat()
    await desktopLegDrops()
    const tappedAt = Date.now()

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await act(async () => {
      await acceptRelayDial(phone!, 1)
    })
    expect(gate?.sendable).toBe(true)
    // The phone slept through the rest of the wait (a suspended JS thread):
    // the wall clock moves on, no timer fires.
    vi.setSystemTime(tappedAt + 11_500)
    await until(() => sent !== null)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: your desktop came back too late to send it. Send it again'
    )
    expect(clearDraftForSend).not.toHaveBeenCalled()
    expect(terminalWrites(1)).toEqual([])
  }, 30_000)

  it('says it could not reach the desktop, not that the link dropped, when the app never connected', async () => {
    // A cold start: the first relay dial is still out when the user sends.
    phone = openRelayOnlyPhone()
    await relayDial(0)
    act(() => {
      renderer = create(createElement(Probe, { client: phone!.logical }))
    })

    let sent: boolean | null = null
    void api!.send('hello').then((result) => {
      sent = result
    })
    await until(() => sent !== null, 100)

    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: could not reach your desktop within 11 s'
    )
  }, 30_000)
})
