import type { ConnectionState, RpcResponse } from '../../transport/types'
import type { RpcClient } from '../../transport/rpc-client'
import { RpcClientRequestTracker } from '../../transport/rpc-client-request-tracker'
import { createStableLogicalRpcClient } from '../../transport/stable-logical-rpc-client'
import { markRpcDeliveryUnknown } from '../../transport/rpc-delivery-ambiguity'
import {
  captureArguments,
  captureValue,
  observeSettlement,
  type Settlement
} from './recording-values'
import type { Rejection } from './recording-scenario'

/** Named once so the two layers of the seam spell the operation's own call the same way. */
type SendRequestArgs = Parameters<RpcClient['sendRequest']>

/**
 * Puts another transport between the operation being recorded and this one. The recorder's own
 * instrumentation stays underneath, so the wrapped client is a transport under test rather than a
 * substitute for this one: `requests`, `payloads` and the scripted replies are all still observed
 * here, and a golden recorded through a wrapper is comparable to the one recorded without it.
 *
 * Declared as a function rather than as an import of the thing that uses it. The page bridge lives
 * in `mobile/src/mobile-web-shell/`, which is inside the recorder's own fence, so the engine naming
 * it would put a product module in `recorderSha256`; `rpc-recording-through-bridge.test.ts` builds
 * the pair and hands it in instead.
 */
export type ScriptedClientWrapper = (client: RpcClient) => RpcClient

export class ScriptedRpcTransport {
  readonly requests: {
    name: string
    args: ReturnType<typeof captureArguments>
    settlement: Settlement
  }[] = []
  readonly payloads: { name: string; json: string }[] = []
  readonly client: RpcClient
  readonly logical
  private counts = new Map<string, number>()
  private bindings = new Map<string, { id: string; params: unknown; completed: boolean }>()
  private aliases = new Map<string, string>()
  private activeName = ''
  /**
   * Logical request names waiting for the physical send that will carry them. A queue rather than
   * one slot because a wrapped transport may forward a send asynchronously, and two sends issued in
   * one turn would overwrite a slot before either reached the wire. Exactly one name is pushed per
   * logical `sendRequest` and exactly one is taken by the physical call it wraps, in the order the
   * operation made them.
   */
  private names: string[] = []
  private frameCount = 0
  private state: ConnectionState = 'connected'
  private listeners = new Set<(state: ConnectionState) => void>()
  private rejects = new Map<string, (error: Error) => void>()
  private tracker = new RpcClientRequestTracker({
    nextId: () => `frame-${++this.frameCount}`,
    getState: () => this.state,
    waitForConnected: async () => {
      if (this.state !== 'connected') {
        throw new Error('Scripted transport disconnected')
      }
    },
    deviceToken: 'recording-device',
    sendEncrypted: (value) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the physical client publishes the frame this transport just serialized.
      const payload = value as { id: string; method: string; params: unknown }
      const name = this.wireNames.shift()
      if (!name) {
        throw new Error('Unbound physical request')
      }
      this.bindings.set(name, { id: payload.id, params: payload.params, completed: false })
      this.payloads.push({ name, json: JSON.stringify(value) })
      return true
    }
  })
  private wireNames: string[] = []

  /**
   * `now` is the recording scheduler's virtual clock; every settlement is stamped from it.
   * `wrapClient` puts a transport under test between the operation and this one; see its type.
   * (Code UI: upstream's second parameter is the shared write ordinal of Orca #21088, Group D,
   * which this recorder does not carry yet; `undefined` holds its place so the call shape matches.)
   */
  constructor(
    private readonly now: () => number = () => 0,
    _nextWriteOrdinal?: undefined,
    wrapClient: ScriptedClientWrapper = (client) => client
  ) {
    const session = this.session()
    this.logical = createStableLogicalRpcClient(session, 'lan')
    // The sandwich the seam is: the recorder observes the operation's own call on the outside, the
    // wrapper carries it, and the inside hands it to the logical client with its name attached.
    const inner = wrapClient({
      ...this.logical,
      sendRequest: (...args: SendRequestArgs) => {
        // Taken here rather than above the wrapper so `session()` still reads exactly one name per
        // physical send: a wrapper that forwards on a microtask arrives after the next logical call
        // has been made, and one slot would hand both sends the second name. Both ways of getting
        // that wrong throw rather than guess: a wrapper that invents a send finds the queue empty,
        // and one that swallows a send leaves a name whose method is not the one now on the wire.
        const name = this.names.shift() ?? '(no logical request)'
        if (name.slice(0, name.lastIndexOf('#')) !== args[0]) {
          throw new Error(`A physical send of ${args[0]} cannot take the name ${name}`)
        }
        this.activeName = name
        return this.logical.sendRequest(...args)
      }
    })
    this.client = {
      ...inner,
      // Outermost on purpose: the operation makes this call at the same moment with or without a
      // wrapper, so the settlement it observes is comparable across the two recordings.
      sendRequest: (...args: SendRequestArgs) => {
        const name = this.occurrence(args[0])
        this.names.push(name)
        const request = {
          name,
          args: captureArguments(args),
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a pending settlement has no settledAt yet.
          settlement: { status: 'pending', startedAt: this.now() } as Settlement
        }
        this.requests.push(request)
        const promise = inner.sendRequest(...args)
        observeSettlement(promise, this.now, (state) => {
          request.settlement = state
        })
        return promise
      }
    }
  }

  /** One occurrence counter per method, so a physical send is named after the logical call. */
  private occurrence(method: string): string {
    const next = (this.counts.get(method) ?? 0) + 1
    this.counts.set(method, next)
    return `${method}#${next}`
  }

  private session(): RpcClient {
    return {
      sendRequest: (...args) => {
        const name = this.activeName
        this.wireNames.push(name)
        return new Promise<RpcResponse>((resolve, reject) => {
          this.rejects.set(name, reject)
          this.tracker.sendRequest(...args).then(resolve, reject)
        })
      },
      subscribe: () => {
        throw new Error('Subscriptions are outside this request-only runner')
      },
      updateTerminalSubscriptionViewport: () => {},
      getState: () => this.state,
      getReconnectAttempt: () => 0,
      getLastConnectedAt: () => 0,
      onStateChange: (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
      notifyForeground: () => {},
      close: () => {
        this.tracker.rejectAll('Connection closed', { deliveryUnknown: true })
      }
    }
  }

  /** Whether a scripted name names a request that was sent and is still waiting for its reply. */
  outstanding(name: string): boolean {
    const binding = this.bindings.get(this.aliases.get(name) ?? name)
    return binding !== undefined && !binding.completed
  }

  bind(alias: string, name: string, params: unknown): void {
    name = this.aliases.get(name) ?? name
    const binding = this.bindings.get(name)
    if (!binding || this.aliases.has(alias)) {
      throw new Error(`Invalid request binding: ${alias}`)
    }
    if (JSON.stringify(captureValue(binding.params)) !== JSON.stringify(captureValue(params))) {
      throw new Error(`Binding params mismatch: ${alias}`)
    }
    this.aliases.set(alias, name)
  }

  complete(name: string, params: unknown, reply: unknown, rejection?: Rejection): void {
    const alias = this.aliases.get(name)
    const requestedName = alias ?? name
    const method = requestedName.split('#')[0]
    if (
      !alias &&
      [...this.bindings].filter(([key, value]) => key.split('#')[0] === method && !value.completed)
        .length > 1
    ) {
      throw new Error(`Concurrent requests require a logical binding: ${name}`)
    }
    name = requestedName
    const binding = this.bindings.get(name)
    if (!binding || binding.completed) {
      throw new Error(`Missing or completed request: ${name}`)
    }
    if (JSON.stringify(captureValue(binding.params)) !== JSON.stringify(captureValue(params))) {
      throw new Error(`Request params mismatch: ${name}`)
    }
    binding.completed = true
    if (rejection) {
      const error =
        rejection.category === 'TypeError'
          ? new TypeError(rejection.message)
          : new Error(rejection.message)
      if (rejection.deliveryUnknown) {
        markRpcDeliveryUnknown(error)
      }
      // Resolve the physical tracker to cancel its deadline before injecting the scripted rejection.
      this.rejects.get(name)?.(error)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scenario asked for a null result, which is a reply shape a host can send.
      this.tracker.resolve({ id: binding.id, ok: true, result: null } as RpcResponse)
    } else {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scenario supplies the reply as JSON; the wire id is the transport’s.
      this.tracker.resolve({ ...(reply as object), id: binding.id } as RpcResponse)
    }
  }

  disconnect(): void {
    this.state = 'disconnected'
    this.tracker.rejectAll('Connection lost', { deliveryUnknown: true })
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  async cutover(): Promise<void> {
    await this.logical.migrateTo(this.session(), 'relay')
  }

  dispose(): void {
    this.logical.close()
  }
}
