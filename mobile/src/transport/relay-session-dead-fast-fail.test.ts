import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fakes = vi.hoisted(() => ({
  linkOptions: null as null | {
    onHello(value: unknown): void
    onAuthenticated(): void
    onText(value: string): void
    onError(error: Error): void
  },
  sendText: vi.fn(() => true),
  close: vi.fn()
}))

vi.mock('./mobile-relay-e2ee-link', () => ({
  MobileRelayE2eeLink: class {
    constructor(options: NonNullable<typeof fakes.linkOptions>) {
      fakes.linkOptions = options
    }
    sendText = fakes.sendText
    close = fakes.close
  }
}))

import { connectMobileRelayRpcSession } from './mobile-relay-rpc-session'

// Read off a Galaxy S23 over the relay on 2026-09-09: one keystroke that
// raced a relay drop parked the serial live-input queue for the full 30 s
// request timeout, and every keystroke typed meanwhile coalesced behind it.

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.onorca.dev',
  cellUrl: 'https://relay-c1.onorca.dev',
  assignmentEpoch: 7,
  relayHostId: 'AbCdEf0123_-xyZ9',
  e2eeFraming: 2 as const
}

function openSession() {
  return connectMobileRelayRpcSession({
    relay,
    resumeToken: 'resume-secret',
    resumeCredentialVersion: 3,
    resumeConfirmReqId: 'confirm-1',
    deviceToken: 'device-token',
    desktopPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    requestTimeoutMs: 30_000
  })
}

async function authenticate(session: ReturnType<typeof openSession>) {
  fakes.linkOptions!.onHello({
    type: 'relay-hello',
    ok: true,
    credentialKind: 'resume',
    leaseExpiresAt: Date.now() + 60_000,
    acceptedCredentialVersion: 3,
    acceptedAs: 'current',
    resumeExpiresAt: Date.now() + 300_000
  })
  fakes.linkOptions!.onAuthenticated()
  await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledTimes(2))
  const [confirmation, capabilities] = fakes.sendText.mock.calls.map(
    ([value]) => JSON.parse(value as string) as { id: string }
  )
  const meta = { _meta: { runtimeId: 'runtime-1' } }
  fakes.linkOptions!.onText(
    JSON.stringify({
      id: confirmation!.id,
      ok: true,
      result: {
        v: 1,
        relay,
        resumeConfirmation: {
          v: 1,
          reqId: 'confirm-1',
          currentVersion: 3,
          acceptedAs: 'current',
          renewed: true,
          resumeExpiresAt: Date.now() + 300_000
        }
      },
      ...meta
    })
  )
  fakes.linkOptions!.onText(JSON.stringify({ id: capabilities!.id, ok: true, result: {}, ...meta }))
  await vi.waitFor(() => expect(session.getState()).toBe('connected'))
  fakes.sendText.mockClear()
}

describe('relay session: requests on a dead or unready session fail fast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    fakes.linkOptions = null
    fakes.sendText.mockReturnValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('rejects a request on a relay session that already died instead of waiting out the 30 s timeout', async () => {
    const session = openSession()
    await authenticate(session)
    fakes.linkOptions!.onError(new Error('cell closed the socket'))
    expect(session.getState()).toBe('disconnected')

    let settled: 'pending' | 'rejected' | 'resolved' = 'pending'
    const request = session.sendRequest('terminal.send', { text: 'a' }).then(
      () => {
        settled = 'resolved'
      },
      () => {
        settled = 'rejected'
      }
    )
    // No timers advanced: the rejection must come from the dead-session check.
    await vi.advanceTimersByTimeAsync(0)
    await request

    expect(settled).toBe('rejected')
    expect(fakes.sendText).not.toHaveBeenCalled()
  })

  it('honours failWhenDisconnected while the relay is still dialing, like the direct client does', async () => {
    const session = openSession()
    expect(session.getState()).not.toBe('connected')

    let settled: 'pending' | 'rejected' | 'resolved' = 'pending'
    const request = session
      .sendRequest('terminal.send', { text: 'a' }, { failWhenDisconnected: true })
      .then(
        () => {
          settled = 'resolved'
        },
        () => {
          settled = 'rejected'
        }
      )
    await vi.advanceTimersByTimeAsync(0)
    await request

    expect(settled).toBe('rejected')
    session.close()
  })

  it('still lets an ordinary request wait for the dial to finish', async () => {
    const session = openSession()
    let settled = false
    const request = session.sendRequest('status.get').then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    session.close()
    await request
    expect(settled).toBe(true)
  })
})
