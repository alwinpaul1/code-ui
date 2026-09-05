import {
  RelayPhoneHelloSchema,
  type RelayPhoneHello
} from '../../../src/shared/mobile-relay-phone-protocol'
import {
  relayHostCloseReasonFrom,
  type RelayHostCloseReason
} from '../../../src/shared/relay-host-close-reason'
import { MobileE2EEV2ClientSession } from './mobile-e2ee-v2-client-session'
import { MobileE2EEV2PhysicalChannel } from './mobile-e2ee-v2-physical-channel'
import { websocketPayloadToUint8 } from './websocket-payload-bytes'

// Native WebSockets normally emit close immediately after error; bound the
// missing-close case so a dead socket cannot leave recovery pending forever.
const RELAY_ERROR_CLOSE_GRACE_MS = 250

export class RelayOuterError extends Error {
  // `detail` is the transport's own words for why the outer socket died. On
  // Android that is OkHttp's "Expected HTTP 101 response but was '503 Service
  // Unavailable'", the only place the cell's HTTP status survives.
  constructor(
    readonly code: number,
    readonly detail?: string
  ) {
    super(detail ? `relay_outer_${code} (${detail})` : `relay_outer_${code}`)
  }
}

type MobileRelayE2eeLinkOptions = {
  endpoint: { cellUrl: string; relayHostId: string }
  credential: string
  expectedCredentialKind: 'invite' | 'resume'
  deviceToken: string
  desktopPublicKeyB64: string
  onAuthenticated: () => void
  onText: (plaintext: string) => void
  onBinary: (plaintext: Uint8Array) => void
  onHello?: (hello: Extract<RelayPhoneHello, { ok: true }>) => void
  // The cell's account of why the desktop is absent, read off the close frame.
  // Reported separately from onError because a rejection is delivered as both a
  // relay-hello and a close, and which one the runtime dispatches first is not
  // ordered — only the close carries the reason, and it must not be lost to
  // that race.
  onHostCloseReason?: (reason: RelayHostCloseReason) => void
  // Fired once relay-auth is on the wire: from here the cell owns the wait.
  onOpen?: () => void
  onError: (error: Error) => void
  createSocket?: (url: string) => WebSocket
}

export class MobileRelayE2eeLink {
  private readonly options: MobileRelayE2eeLinkOptions
  private readonly socket: WebSocket
  private readonly channel: MobileE2EEV2PhysicalChannel
  private outerReady = false
  private closed = false
  private transportErrorTimer: ReturnType<typeof setTimeout> | null = null
  private transportErrorDetail: string | undefined
  private inboundChain: Promise<void> = Promise.resolve()

  constructor(options: MobileRelayE2eeLinkOptions) {
    this.options = options
    this.socket = (options.createSocket ?? ((url) => new WebSocket(url)))(
      relaySocketUrl(options.endpoint)
    )
    const session = MobileE2EEV2ClientSession.create({
      desktopPublicKeyB64: options.desktopPublicKeyB64,
      transport: 'relay',
      relayHostId: options.endpoint.relayHostId
    })
    this.channel = new MobileE2EEV2PhysicalChannel({
      session,
      socket: this.socket,
      deviceToken: options.deviceToken,
      decodeBinary: websocketPayloadToUint8,
      onAuthenticated: options.onAuthenticated,
      onText: options.onText,
      onBinary: options.onBinary,
      onError: (error) => this.fail(error)
    })
    this.bindSocket()
  }

  sendText(plaintext: string): boolean {
    return !this.closed && this.channel.sendText(plaintext)
  }

  sendBinary(plaintext: Uint8Array): boolean {
    return !this.closed && this.channel.sendBinary(plaintext)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.transportErrorTimer) {
      clearTimeout(this.transportErrorTimer)
      this.transportErrorTimer = null
    }
    this.channel.dispose()
    this.socket.close()
  }

  private bindSocket(): void {
    this.socket.onopen = () => {
      try {
        this.socket.send(
          JSON.stringify({
            type: 'relay-auth',
            v: 1,
            mode: 'connect',
            credential: this.options.credential
          })
        )
      } catch (error) {
        this.fail(asError(error))
        return
      }
      this.options.onOpen?.()
    }
    this.socket.onmessage = (event) => {
      this.inboundChain = this.inboundChain
        .then(async () => {
          if (this.closed) {
            return
          }
          if (!this.outerReady) {
            this.acceptHello(event.data)
          } else {
            await this.channel.handleMessage(event.data)
          }
        })
        .catch((error: unknown) => this.fail(asError(error)))
    }
    // `error` is often delivered just before `close`; wait for close so a
    // typed relay code is not replaced by a generic transport error.
    this.socket.onerror = (event) => {
      this.transportErrorDetail ??= transportEventDetail(event)
      this.transportErrorTimer ??= setTimeout(() => {
        this.transportErrorTimer = null
        this.fail(new RelayOuterError(1006, this.transportErrorDetail))
      }, RELAY_ERROR_CLOSE_GRACE_MS)
    }
    this.socket.onclose = (event) => {
      if (this.transportErrorTimer) {
        clearTimeout(this.transportErrorTimer)
        this.transportErrorTimer = null
      }
      // Ahead of fail(), which no-ops once the hello already reported this close.
      const hostCloseReason = relayHostCloseReasonFrom(event.reason)
      if (hostCloseReason) {
        this.options.onHostCloseReason?.(hostCloseReason)
      }
      // A cell's structured close reason already has its own channel above;
      // only free-text reasons (the transport's own words) travel as detail.
      const detail = hostCloseReason
        ? undefined
        : (transportEventDetail({ message: event.reason }) ?? this.transportErrorDetail)
      this.fail(new RelayOuterError(event.code || 1006, detail))
    }
  }

  private acceptHello(raw: unknown): void {
    if (typeof raw !== 'string') {
      throw new Error('expected plaintext relay hello')
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('invalid relay hello JSON')
    }
    const parsed = RelayPhoneHelloSchema.safeParse(value)
    if (!parsed.success) {
      throw new Error('invalid relay hello')
    }
    if (!parsed.data.ok) {
      throw new RelayOuterError(parsed.data.code)
    }
    if (parsed.data.credentialKind !== this.options.expectedCredentialKind) {
      throw new Error('relay credential resolved as an unexpected credential kind')
    }
    this.outerReady = true
    this.options.onHello?.(parsed.data)
    this.channel.start()
  }

  private fail(error: Error): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.transportErrorTimer) {
      clearTimeout(this.transportErrorTimer)
      this.transportErrorTimer = null
    }
    this.channel.dispose()
    this.options.onError(error)
    this.socket.close()
  }
}

function relaySocketUrl(endpoint: { cellUrl: string; relayHostId: string }): string {
  const url = new URL(endpoint.cellUrl)
  url.protocol = 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(endpoint.relayHostId)}`
  return url.toString()
}

function transportEventDetail(event: unknown): string | undefined {
  const message = (event as { message?: unknown } | null)?.message
  if (typeof message !== 'string') {
    return undefined
  }
  const trimmed = message.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 120) : undefined
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
