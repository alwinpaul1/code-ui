import { createElement, useCallback, useEffect, useState } from 'react'
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

import { fakeRelayLinks, resetFakeRelayLinks } from '../transport/relay-desktop-fake-link'
import {
  acceptRelayDial,
  dropRelayLink,
  openRelayOnlyPhone,
  type RelayOnlyPhone
} from '../transport/relay-desktop-test-fakes'
import type { ConnectionState } from '../transport/types'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './use-mobile-native-chat-drafts'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'

// The structured-session half of the 2026-09-25 report: a Claude or Codex
// session tab sends through the bridge, whose write is one agentSession RPC on
// the tab's client. Tapped while the relay re-dials, that RPC reached the dead
// relay session and was refused at once.

const ORIGIN: MobileNativeChatSendOrigin = {
  draftKey: 'draft',
  draftEditGeneration: 0,
  pendingKey: 'pending',
  normalizedText: 'hello',
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true
}

type Bridge = ReturnType<typeof useMobileStructuredNativeChatSendBridge>

describe('a structured session message sent while the relay re-dials', () => {
  let renderer: ReactTestRenderer | null = null
  let bridge: Bridge | null = null
  let connState: ConnectionState | null = null
  let phone: RelayOnlyPhone | null = null
  const acceptSend = vi.fn()
  const clearDraftForSend = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  const onSendError = vi.fn()

  function Probe({
    client,
    sessionId
  }: {
    client: RelayOnlyPhone['logical']
    sessionId: string
  }): null {
    const [state, setState] = useState<ConnectionState>(client.getState())
    useEffect(() => client.onStateChange(setState), [client])
    connState = state
    // The structured session's send, down to its write: one agentSession RPC
    // for the active tab's session, refused or accepted by whatever relay
    // session is live. The controller has one structured lane, bound to the
    // active tab, so a tab switch hands the bridge the next tab's session.
    const sendStructured = useCallback(
      async (text: string): Promise<MobileNativeChatSendOutcome> => {
        try {
          const response = await client.sendRequest('agentSession.send', { sessionId, text })
          return response.ok ? 'accepted' : 'rejected'
        } catch {
          return 'rejected'
        }
      },
      [client, sessionId]
    )
    bridge = useMobileStructuredNativeChatSendBridge({
      agent: 'claude',
      sendStructured,
      // As useMobileStructuredAgentSession reports it for a loaded session.
      sendConditions: { client, sendable: state === 'connected', target: sessionId },
      captureSendOrigin: () => ORIGIN,
      clearDraftForSend,
      acceptSend,
      holdUnconfirmedSend,
      restoreRejectedDraft,
      onSendError
    })
    return null
  }

  async function until(check: () => boolean, stepMs = 10): Promise<void> {
    for (let step = 0; step < 500 && !check(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(stepMs)
      })
    }
    expect(check()).toBe(true)
  }

  async function openConnectedSession(): Promise<RelayOnlyPhone> {
    const opened = openRelayOnlyPhone()
    await acceptRelayDial(opened, 0)
    await opened.started
    act(() => {
      renderer = create(createElement(Probe, { client: opened.logical, sessionId: 'session-a' }))
    })
    await until(() => connState === 'connected')
    return opened
  }

  async function desktopLegDrops(): Promise<void> {
    await act(async () => {
      dropRelayLink(fakeRelayLinks[0]!, 4408)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(connState).toBe('disconnected')
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
    vi.clearAllMocks()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    bridge = null
    connState = null
    phone?.supervisor.stop()
    phone?.logical.close()
    phone = null
    vi.useRealTimers()
  })

  it('goes out on the replacement relay once it is back', async () => {
    phone = await openConnectedSession()
    await desktopLegDrops()

    let outcome: MobileNativeChatSendOutcome | null = null
    void bridge!.sendWithOutcome('hello').then((result) => {
      outcome = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(outcome).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => outcome !== null)

    expect(outcome).toBe('accepted')
    expect(fakeRelayLinks[0]!.sent('agentSession.send')).toEqual([])
    expect(fakeRelayLinks[1]!.sent('agentSession.send')).toHaveLength(1)
    expect(acceptSend).toHaveBeenCalledWith(ORIGIN, 'hello', undefined)
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
    expect(onSendError).not.toHaveBeenCalled()
  }, 30_000)

  it('does not send into the session of a tab the user switched to during the wait', async () => {
    phone = await openConnectedSession()
    await desktopLegDrops()

    let outcome: MobileNativeChatSendOutcome | null = null
    void bridge!.sendWithOutcome('hello').then((result) => {
      outcome = result
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Another agent-session tab, whose own session is loaded.
    act(() => {
      renderer!.update(createElement(Probe, { client: phone!.logical, sessionId: 'session-b' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await acceptRelayDial(phone!, 1)
    })
    await until(() => outcome !== null)

    expect(outcome).toBe('rejected')
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    for (const link of fakeRelayLinks) {
      expect(link.sent('agentSession.send')).toEqual([])
    }
    expect(clearDraftForSend).not.toHaveBeenCalled()
  }, 30_000)

  it('says why and never empties the composer when the relay does not come back', async () => {
    phone = await openConnectedSession()
    await desktopLegDrops()

    let outcome: MobileNativeChatSendOutcome | null = null
    void bridge!.sendWithOutcome('hello').then((result) => {
      outcome = result
    })
    await until(() => outcome !== null, 100)

    expect(outcome).toBe('rejected')
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
    expect(clearDraftForSend).not.toHaveBeenCalled()
    for (const link of fakeRelayLinks) {
      expect(link.sent('agentSession.send')).toEqual([])
    }
  }, 30_000)
})
