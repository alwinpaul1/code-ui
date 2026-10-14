package expo.modules.orcavoicesocket

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString

/**
 * A WebSocket for dictation's voice_stream that sends no Origin header (VoiceSocketRequest.kt).
 * mobile/src/dictation/voice-socket-opener.android.ts opens it; every other platform keeps the
 * JavaScript WebSocket.
 *
 * Each socket has an id chosen by JavaScript; every event names it. Events: onOpen { id },
 * onMessage { id, text }, onError { id, message }, onClose { id, code, reason }. A failure is
 * onError and then onClose with 1006, as React Native's WebSocket reports one. Binary frames from
 * the server are not forwarded: voice_stream sends only JSON text.
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaVoiceSocketModule : Module() {
  private val sockets = ConcurrentHashMap<String, WebSocket>()

  override fun definition() = ModuleDefinition {
    Name("OrcaVoiceSocket")

    Events("onOpen", "onMessage", "onError", "onClose")

    Function("connect") { id: String, url: String, headers: Map<String, String> ->
      sockets.remove(id)?.cancel()
      sockets[id] = client.newWebSocket(voiceSocketRequest(url, headers), listenerFor(id))
    }

    // False when the socket is gone or OkHttp refused the frame (closing, or its queue is full).
    Function("sendText") { id: String, text: String ->
      sockets[id]?.send(text) ?: false
    }

    Function("sendBinary") { id: String, base64: String ->
      sockets[id]?.send(Base64.decode(base64, Base64.NO_WRAP).toByteString()) ?: false
    }

    // The caller is done with it: no event for this id reaches JavaScript afterwards.
    Function("close") { id: String, code: Int, reason: String ->
      sockets.remove(id)?.close(code, reason)
    }

    OnDestroy {
      sockets.values.forEach { it.cancel() }
      sockets.clear()
    }
  }

  private fun listenerFor(id: String) = object : WebSocketListener() {
    // A socket JavaScript closed, or that a newer connect under the same id replaced, says nothing.
    private fun current(webSocket: WebSocket) = sockets[id] === webSocket

    override fun onOpen(webSocket: WebSocket, response: Response) {
      if (current(webSocket)) {
        sendEvent("onOpen", mapOf("id" to id))
      }
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
      if (current(webSocket)) {
        sendEvent("onMessage", mapOf("id" to id, "text" to text))
      }
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
      // Answer the server's close so OkHttp completes the handshake and calls onClosed.
      webSocket.close(code, reason)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
      if (sockets.remove(id, webSocket)) {
        sendEvent("onClose", mapOf("id" to id, "code" to code, "reason" to reason))
      }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
      if (!sockets.remove(id, webSocket)) {
        return
      }
      // A refused upgrade has an HTTP status, which says more than the exception does.
      val status = response?.let { "HTTP ${it.code}: " } ?: ""
      val message = status + (t.message ?: t.javaClass.simpleName)
      sendEvent("onError", mapOf("id" to id, "message" to message))
      sendEvent("onClose", mapOf("id" to id, "code" to 1006, "reason" to message))
    }
  }

  private companion object {
    // One client for every socket. No read timeout: the server may be silent between frames, and
    // the stream's own KeepAlive and finalize timers decide when it has waited long enough.
    val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MINUTES)
        .build()
    }
  }
}
