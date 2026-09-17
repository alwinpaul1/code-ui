import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

let tokenResult: unknown = { ok: true, platform: 'android', token: 'fcm-token-1' }
vi.mock('./push-token', () => ({
  acquirePushToken: vi.fn(async () => tokenResult)
}))

const { registerPushForHost } = await import('./push-registration')

function makeClient(
  respond: (method: string, params: unknown) => unknown,
  state = 'connected'
): { client: RpcClient; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = []
  const client = {
    getState: () => state,
    sendRequest: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params })
      return respond(method, params)
    })
  } as unknown as RpcClient
  return { client, calls }
}

/**
 * The desktop is stock Orca, so `notifications.registerPush` hands the token to
 * the push gateway Orca was built against, not to one this fork controls. A
 * rejection from it is the expected answer today and has to arrive as a readable
 * reason, not as a thrown error or a silent no-op — otherwise the first person
 * to turn this on cannot tell "refused" from "broken".
 */
describe('registering this device for push with a host', () => {
  beforeEach(() => {
    tokenResult = { ok: true, platform: 'android', token: 'fcm-token-1' }
  })

  it('sends the token the platform gave us', async () => {
    const { client, calls } = makeClient(() => ({
      ok: true,
      result: { registered: true, registrationId: 'reg-1' }
    }))
    expect(await registerPushForHost(client)).toEqual({ registered: true, registrationId: 'reg-1' })
    expect(calls).toEqual([
      {
        method: 'notifications.registerPush',
        params: { platform: 'android', token: 'fcm-token-1', filter: {} }
      }
    ])
  })

  it('passes a filter through', async () => {
    const { client, calls } = makeClient(() => ({
      ok: true,
      result: { registered: true, registrationId: 'r' }
    }))
    await registerPushForHost(client, { onlyWhenDesktopAway: true })
    expect(calls[0]?.params).toMatchObject({ filter: { onlyWhenDesktopAway: true } })
  })

  it('reports the gateway refusing this fork’s token in words', async () => {
    const { client } = makeClient(() => ({
      ok: true,
      result: { registered: false, reason: 'gateway_rejected' }
    }))
    expect(await registerPushForHost(client)).toEqual({
      registered: false,
      reason: 'gateway_rejected'
    })
  })

  it('does not call the desktop when there is no token to send', async () => {
    tokenResult = { ok: false, reason: 'no-firebase-config', detail: 'add google-services.json' }
    const { client, calls } = makeClient(() => ({ ok: true, result: {} }))
    expect(await registerPushForHost(client)).toEqual({
      registered: false,
      reason: 'no-push-token',
      detail: 'no-firebase-config: add google-services.json'
    })
    expect(calls).toEqual([])
  })

  // Failure path: an old desktop has no such method, and the call rejects.
  it('turns a rejected request into a reason rather than throwing', async () => {
    const { client } = makeClient(() => {
      throw new Error('method not found')
    })
    expect(await registerPushForHost(client)).toMatchObject({
      registered: false,
      reason: 'request_failed'
    })
  })

  it('reports an error response', async () => {
    const { client } = makeClient(() => ({ ok: false, error: { message: 'unknown method' } }))
    expect(await registerPushForHost(client)).toMatchObject({
      registered: false,
      reason: 'request_failed'
    })
  })

  it('does not dial a host that is not connected', async () => {
    const { client, calls } = makeClient(() => ({ ok: true, result: {} }), 'connecting')
    expect(await registerPushForHost(client)).toMatchObject({ registered: false, reason: 'offline' })
    expect(calls).toEqual([])
  })

  // Degenerate: a desktop that answers with nothing recognisable.
  it('does not read a malformed answer as success', async () => {
    const { client } = makeClient(() => ({ ok: true, result: undefined }))
    expect(await registerPushForHost(client)).toMatchObject({
      registered: false,
      reason: 'request_failed'
    })
  })
})
