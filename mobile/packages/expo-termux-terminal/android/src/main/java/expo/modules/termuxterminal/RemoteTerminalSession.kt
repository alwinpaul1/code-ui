package expo.modules.termuxterminal

import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalOutput
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalViewSession
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

/**
 * A Termux terminal session whose process lives on the desktop.
 *
 * Termux's own TerminalSession owns a local PTY through JNI and is final, so the view is
 * decoupled from it (com.termux.view.TerminalViewSession) and this is the session it draws: the
 * emulator is fed the bytes the relay delivers (`append`), and everything the emulator or the
 * view wants to send to the process (`write`) is handed to `onOutput`, which the Expo view turns
 * into an event the app forwards to the desktop's PTY. Nothing here touches a file descriptor.
 */
class RemoteTerminalSession(
  private val onOutput: (ByteArray) -> Unit,
  private val onCopy: (String) -> Unit,
  private val onPaste: () -> Unit,
  private val onBellRang: () -> Unit,
  private val onScreenChanged: () -> Unit,
  private val onSizeChanged: (columns: Int, rows: Int) -> Unit,
  private val onColorsChangedListener: () -> Unit,
  private val cursorStyle: () -> Int?,
  /** Runs a flush later on the main thread; the view hands in its handler. */
  private val postToMain: (Runnable) -> Unit
) : TerminalOutput(), TerminalViewSession, TerminalSessionClient {
  private var emulator: TerminalEmulator? = null
  private val utf8InputBuffer = ByteArray(5)
  // One scroll callback sends one wheel report per row, each through `write`. Delivered one by
  // one they become one relay send each (the Ghostty wrapper measured 410 ms bursts from that);
  // gathered until the main loop turns, or until the view flushes, a gesture's reports leave as
  // one payload.
  private val pendingOutput = ByteArrayOutputStream()
  private var flushQueued = false

  /** Creates (or recreates) the emulator at a size; the transcript is Termux's default 2000 rows. */
  fun initializeEmulator(columns: Int, rows: Int, cellWidthPixels: Int, cellHeightPixels: Int) {
    emulator = TerminalEmulator(this, columns, rows, cellWidthPixels, cellHeightPixels, TRANSCRIPT_ROWS, this)
  }

  private var appending = false

  /** Bytes from the desktop's PTY. Main thread only, like TerminalSession's handler. */
  fun append(bytes: ByteArray, length: Int) {
    val term = emulator ?: return
    appending = true
    try {
      term.append(bytes, length)
    } finally {
      appending = false
    }
    onScreenChanged()
  }

  fun reset() {
    emulator?.reset()
    onScreenChanged()
  }

  override fun getEmulator(): TerminalEmulator? = emulator

  override fun updateSize(columns: Int, rows: Int, cellWidthPixels: Int, cellHeightPixels: Int) {
    val term = emulator
    if (term == null) {
      initializeEmulator(columns, rows, cellWidthPixels, cellHeightPixels)
    } else {
      term.resize(columns, rows, cellWidthPixels, cellHeightPixels)
    }
    onSizeChanged(columns, rows)
  }

  // TerminalOutput: everything bound for the process.
  override fun write(data: ByteArray, offset: Int, count: Int) {
    if (count <= 0) return
    pendingOutput.write(data, offset, count)
    if (!flushQueued) {
      flushQueued = true
      postToMain { flushOutput() }
    }
  }

  /**
   * Hands what is pending to the app now, as one payload. The view calls it around every
   * append so a chunk's query answers leave inside the same call that fed the chunk (the
   * replay guard on the JS side is scoped to that call) and never share a payload with a
   * gesture's wheel reports, which the app classifies whole.
   */
  fun flushOutput() {
    flushQueued = false
    if (pendingOutput.size() == 0) return
    val bytes = pendingOutput.toByteArray()
    pendingOutput.reset()
    onOutput(bytes)
  }

  /** As TerminalSession.writeCodePoint: UTF-8, with ESC in front when alt is down. */
  override fun writeCodePoint(prependEscape: Boolean, codePoint: Int) {
    require(codePoint in 0..1114111 && (codePoint < 0xD800 || codePoint > 0xDFFF)) { "Invalid code point: $codePoint" }
    var bufferPosition = 0
    if (prependEscape) utf8InputBuffer[bufferPosition++] = 27
    when {
      codePoint <= 0x7F -> utf8InputBuffer[bufferPosition++] = codePoint.toByte()
      codePoint <= 0x7FF -> {
        utf8InputBuffer[bufferPosition++] = (0xC0 or (codePoint shr 6)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or (codePoint and 0x3F)).toByte()
      }
      codePoint <= 0xFFFF -> {
        utf8InputBuffer[bufferPosition++] = (0xE0 or (codePoint shr 12)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or ((codePoint shr 6) and 0x3F)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or (codePoint and 0x3F)).toByte()
      }
      else -> {
        utf8InputBuffer[bufferPosition++] = (0xF0 or (codePoint shr 18)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or ((codePoint shr 12) and 0x3F)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or ((codePoint shr 6) and 0x3F)).toByte()
        utf8InputBuffer[bufferPosition++] = (0x80 or (codePoint and 0x3F)).toByte()
      }
    }
    write(utf8InputBuffer, 0, bufferPosition)
  }

  override fun titleChanged(oldTitle: String?, newTitle: String?) {}
  override fun onCopyTextToClipboard(text: String) {
    // OSC 52 arrives through this same method while a chunk is being appended; a program on the
    // desktop (or a replayed snapshot) does not get to write the phone's clipboard. Only the
    // user's own selection copy, which comes from the view between appends, goes through.
    if (!appending) onCopy(text)
  }
  override fun onPasteTextFromClipboard() = onPaste()
  override fun onBell() = onBellRang()
  override fun onColorsChanged() = onColorsChangedListener()

  // TerminalSessionClient, trimmed with the PTY session: the emulator asks only about the cursor.
  override fun onTerminalCursorStateChange(state: Boolean) = onScreenChanged()
  override fun getTerminalCursorStyle(): Int? = cursorStyle()
  override fun logError(tag: String?, message: String?) {}
  override fun logWarn(tag: String?, message: String?) {}
  override fun logInfo(tag: String?, message: String?) {}
  override fun logDebug(tag: String?, message: String?) {}
  override fun logVerbose(tag: String?, message: String?) {}
  override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
  override fun logStackTrace(tag: String?, e: Exception?) {}

  companion object {
    const val TRANSCRIPT_ROWS = 2000
    fun utf8(text: String): ByteArray = text.toByteArray(StandardCharsets.UTF_8)
  }
}
