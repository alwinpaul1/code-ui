package expo.modules.orcavoicesocket

import okhttp3.Request

/**
 * The upgrade request for Anthropic's voice_stream, with exactly the headers JavaScript passed and
 * NO Origin.
 *
 * React Native's own WebSocket (WebSocketModule.kt) adds `origin` to every request that does not
 * name one, and the server refuses a socket that carries any: "WebSocket connection origin is not
 * allowed" (0.9.140, 2026-10-14). Claude Code (Node `ws`) and the Claude Android app (OkHttp)
 * send none. An Origin from the caller is dropped too, so no header map can bring it back.
 */
internal fun voiceSocketRequest(url: String, headers: Map<String, String>): Request {
  val builder = Request.Builder().url(url)
  for ((name, value) in headers) {
    if (!name.equals("origin", ignoreCase = true)) {
      builder.addHeader(name, value)
    }
  }
  return builder.build()
}
