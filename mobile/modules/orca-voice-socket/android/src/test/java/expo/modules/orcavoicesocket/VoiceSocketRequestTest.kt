package expo.modules.orcavoicesocket

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceSocketRequestTest {
  private val url = "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream?encoding=linear16"

  @Test
  fun sendsNoOriginHeader() {
    val request = voiceSocketRequest(url, mapOf("Authorization" to "Bearer tok", "x-app" to "cli"))
    assertNull(request.header("Origin"))
    assertEquals("Bearer tok", request.header("Authorization"))
    assertEquals("cli", request.header("x-app"))
  }

  @Test
  fun dropsAnOriginTheCallerPassed() {
    val request = voiceSocketRequest(url, mapOf("origin" to "https://x", "ORIGIN" to "https://y"))
    assertNull(request.header("Origin"))
    assertEquals(0, request.headers.size)
  }
}
