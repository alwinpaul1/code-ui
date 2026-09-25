import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
// The import inside the factory is forced: vi.mock is hoisted above every
// static import, so the factory cannot reach one.
vi.mock('./mobile-relay-e2ee-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-relay-e2ee-link')>()),
  MobileRelayE2eeLink: (await import('./relay-desktop-fake-link')).FakeRelayLink
}))

import { fakeRelayLinks, resetFakeRelayLinks } from './relay-desktop-fake-link'
import { acceptRelayDial, dropRelayLink, openRelayOnlyPhone } from './relay-desktop-test-fakes'

// What puts a relay-only phone's tab into a state other than 'connected' while
// the app is in use, and what a send tapped then runs into. Reported
// 2026-09-25: "sometimes when i send message i see message not send
// disconnected". The phone's own log from 2026-09-10 (d9434e2a) showed the
// trigger then: the desktop's relay leg dropped and the cell closed the
// phone's socket with relay_outer_4408. This drives that close through the
// real relay session, logical client and supervisor.
describe('a relay-only phone when the desktop drops its relay leg', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'))
    resetFakeRelayLinks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads disconnected until the supervisor migrates a replacement in, and refuses requests meanwhile', async () => {
    const phone = openRelayOnlyPhone()
    await acceptRelayDial(phone, 0)
    await phone.started
    expect(phone.logical.getActivePath()).toBe('relay')
    phone.states.length = 0

    // PEER_DROPPED: the cell's word that the desktop's side of the splice went away.
    dropRelayLink(fakeRelayLinks[0]!, 4408)
    expect(phone.logical.getState()).toBe('disconnected')

    // Nothing rides the reconnect at the transport: the dead relay session is
    // still the logical client's active session, and it refuses at once.
    const inGap = phone.logical
      .sendRequest('terminal.send', { terminal: 'term', text: 'hi', enter: true })
      .then(
        () => 'resolved',
        (error: Error) => error.message
      )
    await vi.advanceTimersByTimeAsync(0)
    await expect(inGap).resolves.toMatch(/relay session/)
    expect(fakeRelayLinks[0]!.sent('terminal.send')).toHaveLength(0)

    // The supervisor books a transport backoff (250 ms at this jitter) and
    // dials again; the tab reads connected once that dial is migrated in.
    await vi.advanceTimersByTimeAsync(249)
    expect(fakeRelayLinks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await acceptRelayDial(phone, 1)
    // The whole gap, as the tab's header and every send gate see it.
    expect(phone.states).toEqual(['disconnected', 'handshaking', 'connected'])

    // And a request on the replacement goes out.
    const after = await phone.logical.sendRequest('terminal.send', {
      terminal: 'term',
      text: 'hi',
      enter: true
    })
    expect(after.ok).toBe(true)
    expect(fakeRelayLinks[1]!.sent('terminal.send')).toHaveLength(1)
    phone.supervisor.stop()
    phone.logical.close()
  })
})
