import { encodeBase64Bytes } from '../transport/base64-byte-codec'

/**
 * The socket AnthropicVoiceStream talks through, so the stream's logic (KeepAlive, CloseStream,
 * finalize timers, error and close diagnostics) is the same whichever socket carries it.
 *
 * Two carry it. On Android, modules/orca-voice-socket's OkHttp socket, because React Native's
 * Android WebSocket adds an `origin` header to every connection that does not name one
 * (WebSocketModule.kt) and voice_stream refuses any socket with an Origin: "WebSocket connection
 * origin is not allowed" (0.9.140, 2026-10-14). Everywhere else, the JavaScript WebSocket.
 * voice-socket-opener(.android).ts picks.
 */
export type VoiceSocketHandlers = {
  readonly onOpen: () => void
  readonly onMessage: (text: string) => void
  /** Null when the socket gave no reason. Always followed by onClose. */
  readonly onError: (message: string | null) => void
  readonly onClose: (code: number, reason: string) => void
}

export type VoiceSocket = {
  readonly isOpen: () => boolean
  readonly sendText: (text: string) => void
  readonly sendBinary: (bytes: Uint8Array) => void
  /** Detaches the handlers first: nothing is reported for this socket afterwards. */
  readonly close: () => void
}

export type OpenVoiceSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
  handlers: VoiceSocketHandlers
) => VoiceSocket

/** React Native's (or the browser's) WebSocket. On Android it carries an Origin; see above. */
export const openWebSocketVoiceSocket: OpenVoiceSocket = (url, headers, handlers) => {
  // @ts-expect-error — RN WebSocket supports 3 args; the DOM typedef does not.
  let ws: WebSocket | null = new WebSocket(url, undefined, { headers })
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => handlers.onOpen()
  ws.onmessage = (event: WebSocketMessageEvent) => {
    if (typeof event.data === 'string') {
      handlers.onMessage(event.data)
    }
  }
  ws.onerror = (event: Event) => {
    const message = (event as { message?: unknown }).message
    handlers.onError(typeof message === 'string' && message ? message : null)
  }
  ws.onclose = (event: WebSocketCloseEvent) => handlers.onClose(event.code ?? 1005, event.reason ?? '')
  const isOpen = () => ws?.readyState === WebSocket.OPEN
  return {
    isOpen,
    sendText: (text) => {
      if (isOpen()) {
        ws?.send(text)
      }
    },
    sendBinary: (bytes) => {
      if (isOpen()) {
        ws?.send(bytes)
      }
    },
    close: () => {
      const socket = ws
      ws = null
      if (!socket) {
        return
      }
      try {
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      } catch {
        // Already gone.
      }
    }
  }
}

type Subscription = { remove: () => void }

/** What modules/orca-voice-socket (OrcaVoiceSocketModule.kt) exposes to JavaScript. */
export type NativeVoiceSocketModule = {
  connect: (id: string, url: string, headers: Record<string, string>) => void
  sendText: (id: string, text: string) => boolean
  sendBinary: (id: string, base64: string) => boolean
  close: (id: string, code: number, reason: string) => void
  addListener: (
    event: 'onOpen' | 'onMessage' | 'onError' | 'onClose',
    listener: (payload: NativeVoiceSocketEvent) => void
  ) => Subscription
}

export type NativeVoiceSocketEvent = {
  id: string
  text?: string
  message?: string
  code?: number
  reason?: string
}

let nextNativeSocketId = 0

/** Drops any origin the caller named; the native request builder drops it again. */
function withoutOrigin(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'origin') {
      out[name] = value
    }
  }
  return out
}

/** modules/orca-voice-socket's OkHttp socket: no Origin header, audio as base64 per chunk. */
export function openNativeVoiceSocket(native: NativeVoiceSocketModule): OpenVoiceSocket {
  return (url, headers, handlers) => {
    nextNativeSocketId += 1
    const id = `voice-${nextNativeSocketId}`
    let open = false
    let closed = false
    const ours = (listener: (event: NativeVoiceSocketEvent) => void) => (event: NativeVoiceSocketEvent) => {
      if (!closed && event.id === id) {
        listener(event)
      }
    }
    const subscriptions = [
      native.addListener(
        'onOpen',
        ours(() => {
          open = true
          handlers.onOpen()
        })
      ),
      native.addListener(
        'onMessage',
        ours((event) => {
          if (typeof event.text === 'string') {
            handlers.onMessage(event.text)
          }
        })
      ),
      native.addListener(
        'onError',
        ours((event) => handlers.onError(event.message ? event.message : null))
      ),
      native.addListener(
        'onClose',
        ours((event) => {
          open = false
          detach()
          handlers.onClose(event.code ?? 1005, event.reason ?? '')
        })
      )
    ]
    function detach(): void {
      closed = true
      for (const subscription of subscriptions) {
        subscription.remove()
      }
    }
    native.connect(id, url, withoutOrigin(headers))
    return {
      isOpen: () => open && !closed,
      sendText: (text) => {
        if (open && !closed) {
          native.sendText(id, text)
        }
      },
      sendBinary: (bytes) => {
        if (open && !closed) {
          native.sendBinary(id, encodeBase64Bytes(bytes))
        }
      },
      close: () => {
        if (closed) {
          return
        }
        open = false
        detach()
        native.close(id, 1000, '')
      }
    }
  }
}
