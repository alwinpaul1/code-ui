import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// As in use-mobile-terminal-paste.test.ts: the hook's own hooks are called,
// not cached, since nothing is mounted.
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory()
}))
vi.mock('expo-clipboard', () => ({
  getStringAsync: async () => 'ls -la',
  getImageAsync: async () => null
}))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }))
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }))
vi.mock('../terminal/worker-terminal-takeover-report', () => ({
  reportWorkerTerminalUserInput: vi.fn()
}))
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
import { useMobileTerminalPaste } from './use-mobile-terminal-paste'

// The terminal paste of the 2026-09-25 sweep. It does not wait for a relay
// re-dial: a paste that is not bracketed runs its lines in the shell, and the
// screen it was meant for may have moved on by the time the link is back. But
// a relay that dropped while the paste was being prepared made it do nothing
// at all, or, a render before the screen knew, write into the dead relay and
// say only "Paste failed". It now checks the client itself before writing and
// says the connection went.

describe('a terminal paste when the relay drops under it', () => {
  let phone: RelayOnlyPhone | null = null
  const showToast = vi.fn()
  const onError = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
    vi.clearAllMocks()
  })
  afterEach(() => {
    phone?.supervisor.stop()
    phone?.logical.close()
    phone = null
    vi.useRealTimers()
  })

  async function openConnected(): Promise<RelayOnlyPhone> {
    const opened = openRelayOnlyPhone()
    await acceptRelayDial(opened, 0)
    await opened.started
    return opened
  }

  /** `mirrorState`: the screen has re-rendered with the drop (connStateRef is
   *  written on a render, so it trails the socket by one). */
  function useDroppingPaste(opened: RelayOnlyPhone, mirrorState: boolean): Promise<void> {
    const connStateRef: { current: ConnectionState } = { current: 'connected' }
    if (mirrorState) {
      opened.logical.onStateChange((state) => {
        connStateRef.current = state
      })
    }
    return useMobileTerminalPaste({
      agent: 'claude',
      activeHandle: 'term',
      activeHandleRef: { current: 'term' },
      activeSessionTabTypeRef: { current: 'terminal' },
      canSend: true,
      client: opened.logical,
      clientRef: { current: opened.logical },
      connState: 'connected',
      connStateRef,
      deviceTokenRef: { current: null },
      // The relay drops while the pending IME text is flushed ahead of the paste.
      flushPendingLiveInputBeforeExternalSend: async () => {
        dropRelayLink(fakeRelayLinks[0]!, 4408)
        return true
      },
      getActiveWorktreeConnectionId: async () => null,
      onError,
      onSuccess,
      ptyModesRef: { current: new Map() },
      refreshCanPaste: vi.fn(),
      showToast
    })()
  }

  it('says the paste was not sent instead of doing nothing when the screen already knows the link dropped', async () => {
    phone = await openConnected()
    await useDroppingPaste(phone, true)

    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'Paste not sent: not connected to your desktop',
      1500
    )
    expect(onError).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(fakeRelayLinks[0]!.sent('terminal.send')).toEqual([])
  }, 30_000)

  it('does not write into the dead relay, and says why, when the link dropped a render before the screen knew', async () => {
    phone = await openConnected()
    await useDroppingPaste(phone, false)

    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'Paste not sent: not connected to your desktop',
      1500
    )
    expect(onError).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
  }, 30_000)
})
