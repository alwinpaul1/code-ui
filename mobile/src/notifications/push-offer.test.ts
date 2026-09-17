import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

let remotePushEnabled = false
let registerOutcome: unknown = { registered: true, registrationId: 'reg-1' }
let registerThrows = false
const registerCalls: unknown[] = []
const taskRegistrations: number[] = []

vi.mock('../storage/preferences', () => ({
  loadRemotePushEnabled: vi.fn(async () => remotePushEnabled)
}))
vi.mock('./push-background-task', () => ({
  registerPushBackgroundTask: vi.fn(async () => {
    taskRegistrations.push(1)
    return true
  })
}))
vi.mock('./push-registration', () => ({
  registerPushForHost: vi.fn(async (client: unknown) => {
    if (registerThrows) {
      throw new Error('boom')
    }
    registerCalls.push(client)
    return registerOutcome
  })
}))

const { offerPushTokenToHost } = await import('./push-offer')
const { lastPushRegistrationOutcome } = await import('./push-registration-outcome')

const client = {} as RpcClient

/**
 * Offering the token happens inside a connection effect. Two things must hold
 * there: someone who never asked for remote push must never have a token
 * leave their phone, and nothing this does may reject into an effect that has
 * no catch.
 */
describe('offering a push token when a host connects', () => {
  beforeEach(() => {
    remotePushEnabled = false
    registerThrows = false
    registerOutcome = { registered: true, registrationId: 'reg-1' }
    registerCalls.length = 0
    taskRegistrations.length = 0
  })

  it('sends nothing for someone who has not turned remote push on', async () => {
    await offerPushTokenToHost(client, 'host-a')
    expect(registerCalls).toEqual([])
    expect(taskRegistrations).toEqual([])
  })

  it('registers once the user has asked for it', async () => {
    remotePushEnabled = true
    await offerPushTokenToHost(client, 'host-a')
    expect(registerCalls).toEqual([client])
    expect(taskRegistrations).toHaveLength(1)
  })

  it('keeps the answer so a settings screen can say why push is off', async () => {
    remotePushEnabled = true
    registerOutcome = { registered: false, reason: 'gateway_rejected' }
    await offerPushTokenToHost(client, 'host-a')
    expect(lastPushRegistrationOutcome('host-a')).toEqual({
      registered: false,
      reason: 'gateway_rejected'
    })
  })

  // Failure path: an effect has nowhere to put a rejection.
  it('does not reject into the connection effect', async () => {
    remotePushEnabled = true
    registerThrows = true
    await expect(offerPushTokenToHost(client, 'host-a')).resolves.toBeUndefined()
  })

  it('has no answer for a host it never offered to', () => {
    expect(lastPushRegistrationOutcome('host-never')).toBeUndefined()
  })
})
