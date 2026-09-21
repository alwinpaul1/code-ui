import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { RpcClientStreamRegistry } from '../transport/rpc-client-stream-registry'
import type { RpcResponse } from '../transport/types'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

// The same module mocks mobile-notifications.test.ts carries; that file sits at its
// max-lines ceiling, so the dispose contract lives beside it instead of inside it.
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 18 }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined)
  }
}))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

type SentFrame = { id: string; method: string; params: unknown }

/** The registry sends through an `unknown` port, so name the shape the assertions read. */
function readSentFrame(request: unknown): SentFrame {
  if (
    typeof request !== 'object' ||
    request === null ||
    !('id' in request) ||
    typeof request.id !== 'string' ||
    !('method' in request) ||
    typeof request.method !== 'string'
  ) {
    throw new Error('The stream registry sent a frame without a string id and method')
  }
  return {
    id: request.id,
    method: request.method,
    params: 'params' in request ? request.params : undefined
  }
}

/** The real stream registry, so dispose-before-ready is answered by the transport, not by a fake. */
function registryClient() {
  const sent: SentFrame[] = []
  const requests: { method: string; params: unknown }[] = []
  let id = 0
  const registry = new RpcClientStreamRegistry({
    nextId: () => `rpc-${++id}`,
    deviceToken: 'device-token',
    getState: () => 'connected',
    sendEncrypted: (request) => {
      sent.push(readSentFrame(request))
      return true
    }
  })
  const client = {
    sendRequest: async (method: string, params: unknown) => {
      requests.push({ method, params })
      return { id: 'reply-1', ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
    },
    subscribe: (
      method: string,
      params: unknown,
      onData: (data: unknown) => void,
      options?: unknown
    ) => registry.subscribe(method, params, onData, options as never),
    getState: () => 'connected'
  } as unknown as RpcClient
  return { registry, sent, requests, client }
}

function readyReply(id: string, subscriptionId: string): RpcResponse {
  return {
    id,
    ok: true,
    streaming: true,
    result: { type: 'ready', subscriptionId },
    _meta: { runtimeId: 'runtime-1' }
  }
}

// Why the real registry (upstream #21293): the module used to carry a dispose-before-ready
// arm inside the 'ready' handler. `disposed` is set only on the disposer's first line and its
// next statement detaches the stream listener in every transport, so the arm could never run;
// these two cases state that on the transport itself rather than on a fake that would call the
// callback whenever a test told it to. Both pass with the arm present and with it gone.
describe('subscribeToDesktopNotifications disposal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHostNotificationSessionsForTests()
  })

  it('never runs the ready arm when the disposer ran before the reply landed', () => {
    const rpc = registryClient()
    const stop = subscribeToDesktopNotifications(rpc.client, 'host-1')
    const subscribeFrame = rpc.sent[0]!
    expect(subscribeFrame.method).toBe('notifications.subscribe')

    stop()
    rpc.registry.handleResponse(readyReply(subscribeFrame.id, 'sub-1'))

    // The subscription id never reaches this module, so nothing closes the host's stream and
    // nothing asks for a catch-up.
    expect(rpc.requests).toEqual([])
    expect(rpc.sent).toHaveLength(1)
  })

  it('closes the host stream when the disposer runs after the ready reply', async () => {
    const rpc = registryClient()
    const stop = subscribeToDesktopNotifications(rpc.client, 'host-1')
    rpc.registry.handleResponse(readyReply(rpc.sent[0]!.id, 'sub-1'))

    stop()
    await Promise.resolve()

    expect(rpc.requests).toContainEqual({
      method: 'notifications.unsubscribe',
      params: { subscriptionId: 'sub-1' }
    })
  })
})
