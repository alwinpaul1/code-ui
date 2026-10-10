import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'

// Orca #26392. A Send whose acknowledgement was lost used to keep its operation id in a journal
// keyed by the text, so a later Send of the same words went out under that id and the host
// answered with the first attempt's unresolved row: "Delivery unconfirmed" for every later press,
// across relaunches. Each press is its own action now.

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

function fieldsOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected an object')
  }
  return Object.fromEntries(Object.entries(value))
}

describe('a new phone send after an acknowledgement was lost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const saved = new Map<string, string>()
    storage.getItem.mockImplementation(async (key: string) => saved.get(key) ?? null)
    storage.setItem.mockImplementation(async (key: string, value: string) => saved.set(key, value))
    storage.removeItem.mockImplementation(async (key: string) => saved.delete(key))
  })

  it.each([false, true])(
    'delivers identical text as a new action while the old host entry stays unknown (relaunch %s)',
    async (relaunch) => {
      const ids: string[] = []
      const delivered: string[] = []
      // The host's ledger: a second request under a recorded id is answered from it, never
      // delivered again, so a reused id can only ever replay the first attempt's answer.
      const ledger = new Set<string>()
      const sendRequest = vi.fn<RpcClient['sendRequest']>(async (_method, params) => {
        const envelope = fieldsOf(fieldsOf(params).envelope)
        const id = String(envelope.clientOperationId)
        const replayed = ledger.has(id)
        ids.push(id)
        if (!replayed) {
          ledger.add(id)
          delivered.push(id)
          if (delivered.length === 1) {
            throw markRpcDeliveryUnknown(new Error('Connection closed after dispatch'))
          }
        }
        return {
          id: 'response',
          ok: true,
          result: {
            ok: true,
            replayed,
            fence: 3,
            cursor: { epoch: 'epoch', sequence: 1 },
            value: {
              clientMessageId: id,
              submission: {
                clientMessageId: id,
                fence: 3,
                payloadFingerprint: String(envelope.payloadFingerprint),
                dispatchState: id === delivered[0] ? 'unknown' : 'accepted',
                providerItemId: null,
                reason: null,
                submittedAt: Date.now(),
                resolvedAt: null
              }
            }
          }
        }
      })
      const clientFor = (): RpcClient => ({
        sendRequest,
        subscribe: vi.fn(() => vi.fn()),
        updateTerminalSubscriptionViewport: () => {},
        getState: () => 'connected',
        getReconnectAttempt: () => 0,
        getLastConnectedAt: () => null,
        onStateChange: () => () => {},
        notifyForeground: () => {},
        close: () => {}
      })
      let client = clientFor()
      const onError = vi.fn()
      const message = {
        sessionId: 'session',
        expectedRuntimeFence: 3,
        text: 'please continue',
        attachments: [],
        onError
      }
      const send = () => sendMobileStructuredAgentSessionMessage({ ...message, client })

      expect(await send()).toBe('unknown')
      if (relaunch) {
        client = clientFor()
      }
      expect(await send()).toBe('accepted')
      expect(delivered).toHaveLength(2)
      expect(new Set(ids).size).toBe(2)
      expect(onError).not.toHaveBeenCalled()
      expect(storage.getItem).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
    }
  )

  // The other half (2026-10-10): an AUTOMATIC retry of one press, which the outbox makes after
  // the app was closed under it, is the same message. It carries the press's stored id, so the
  // ledger answers it from the first attempt and the agent gets the message once.
  it('sends an outbox retry of one press under that press id, so the host never posts it twice', async () => {
    const ids: string[] = []
    const delivered: string[] = []
    const ledger = new Set<string>()
    const sendRequest = vi.fn<RpcClient['sendRequest']>(async (_method, params) => {
      const envelope = fieldsOf(fieldsOf(params).envelope)
      const id = String(envelope.clientOperationId)
      ids.push(id)
      const replayed = ledger.has(id)
      if (!replayed) {
        ledger.add(id)
        delivered.push(id)
        throw markRpcDeliveryUnknown(new Error('Connection closed after dispatch'))
      }
      return {
        id: 'response',
        ok: true,
        result: {
          ok: true,
          replayed,
          fence: 3,
          cursor: { epoch: 'epoch', sequence: 1 },
          value: {
            clientMessageId: id,
            submission: {
              clientMessageId: id,
              fence: 3,
              payloadFingerprint: String(envelope.payloadFingerprint),
              dispatchState: 'accepted',
              providerItemId: null,
              reason: null,
              submittedAt: Date.now(),
              resolvedAt: null
            }
          }
        }
      }
    })
    const client: RpcClient = {
      sendRequest,
      subscribe: vi.fn(() => vi.fn()),
      updateTerminalSubscriptionViewport: () => {},
      getState: () => 'connected',
      getReconnectAttempt: () => 0,
      getLastConnectedAt: () => null,
      onStateChange: () => () => {},
      notifyForeground: () => {},
      close: () => {}
    }
    const operationId = `${Date.now()}-${'a'.repeat(32)}`
    const send = () =>
      sendMobileStructuredAgentSessionMessage({
        client,
        sessionId: 'session',
        expectedRuntimeFence: 3,
        text: 'please continue',
        attachments: [],
        operationId,
        onError: vi.fn()
      })

    expect(await send()).toBe('unknown')
    expect(await send()).toBe('accepted')
    expect(ids).toEqual([operationId, operationId])
    expect(delivered).toEqual([operationId])
  })
})
