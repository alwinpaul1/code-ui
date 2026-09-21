package expo.modules.termuxterminal

import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewGroup
import com.termux.terminal.TerminalColors
import com.termux.terminal.TerminalEmulator
import com.termux.view.TerminalViewCells
import com.termux.view.TerminalViewClient
import com.termux.view.TerminalViewSession
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.Properties
import kotlin.math.roundToInt

/** Termux's own default, in dp; the app scales it by the user's text-size preset. */
private const val DEFAULT_FONT_DP = 13f

/** One pinch step; 1.25 lands on the next preset from every preset the app keeps. */
private const val PINCH_STEP = 1.25f

/**
 * Typeface.MONOSPACE is an OEM alias; Samsung's FlipFont substitutes a proportional face for it
 * in-process (measured on a Galaxy S23: 0.84 em cells, a 34-column grid). Opening the system
 * file by path bypasses the alias, the way the libghostty view before this did.
 */
private val SYSTEM_MONO_FONT_FILES = listOf(
  "/system/fonts/DroidSansMono.ttf",
  "/system/fonts/RobotoMono-Regular.ttf",
  "/system/fonts/CutiveMono.ttf"
)

/**
 * Termux's terminal, drawn natively, fed by the desktop's PTY.
 *
 * Bytes from the desktop go into the emulator (`writeText`); keystrokes, wheel reports and the
 * emulator's own query answers come out as `onInput`; drawing, scrolling, selection and pinch
 * are com.termux.view's own. The grid is the view's too: it derives columns and rows from its
 * pixels and font and reports them on `onResize`, and the app fits the desktop PTY to that.
 * Focus, the IME and the accessory row stay with React Native (see HostedTerminalView).
 */
class TermuxTerminalView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onInput by EventDispatcher()
  private val onResize by EventDispatcher()
  private val onModes by EventDispatcher()
  private val onSelection by EventDispatcher()
  private val onCopy by EventDispatcher()
  private val onFontSize by EventDispatcher()
  private val onTap by EventDispatcher()
  private val onMetrics by EventDispatcher()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val density = context.resources.displayMetrics.density
  private var fontDp = DEFAULT_FONT_DP
  private var lastGrid: Pair<Int, Int>? = null
  private var themedEmulator: TerminalEmulator? = null
  private var lastModes: List<Any> = emptyList()
  private var lastMetrics: List<Any> = emptyList()

  private val monoTypeface: Typeface = monoWithSymbols(context)

  private val session = RemoteTerminalSession(
    onOutput = { bytes ->
      onInput(
        mapOf(
          "data" to Base64.encodeToString(bytes, Base64.NO_WRAP),
          "text" to String(bytes, Charsets.UTF_8)
        )
      )
    },
    onCopy = { text -> onCopy(mapOf("text" to text)) },
    onPaste = {},
    onBellRang = {},
    onScreenChanged = { screenChanged() },
    onSizeChanged = { columns, rows -> reportSize(columns, rows) },
    onColorsChangedListener = { terminal.invalidate() },
    cursorStyle = { null },
    postToMain = { runnable -> mainHandler.post(runnable) }
  )

  private val client = object : TerminalViewClient {
    override fun onScale(scale: Float): Float {
      // Termux's own rule: a pinch past 10% is one step, and the factor restarts at 1. The size
      // itself is not changed here; the app snaps the step to a preset and sets fontSize back.
      if (scale < 0.9f || scale > 1.1f) {
        val next = if (scale > 1f) fontDp * PINCH_STEP else fontDp / PINCH_STEP
        onFontSize(mapOf("fontSize" to next))
        return 1f
      }
      return scale
    }

    override fun onSingleTapUp(e: MotionEvent) {
      val term = session.getEmulator() ?: return
      val col = TerminalViewCells.columnAt(terminal, e.x)
      val row = TerminalViewCells.rowAt(terminal, e.y)
      onTap(mapOf("line" to TerminalViewCells.rowText(term, row), "col" to col, "row" to row))
    }

    override fun shouldBackButtonBeMappedToEscape() = false
    override fun shouldEnforceCharBasedInput() = true
    override fun shouldUseCtrlSpaceWorkaround() = false
    override fun isTerminalViewSelected() = true
    override fun copyModeChanged(copyMode: Boolean) {
      onSelection(mapOf("active" to copyMode))
    }
    override fun onKeyDown(keyCode: Int, e: KeyEvent, session: TerminalViewSession): Boolean = false
    override fun onKeyUp(keyCode: Int, e: KeyEvent): Boolean = false
    override fun onLongPress(event: MotionEvent): Boolean = false
    override fun readControlKey() = false
    override fun readAltKey() = false
    override fun readShiftKey() = false
    override fun readFnKey() = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalViewSession): Boolean = false
    override fun onEmulatorSet() {
      // The view raises this on every grid change (each keyboard show and hide), not only when
      // the emulator is new; colours are reset to the scheme once per emulator, or a program's
      // own OSC 4/10/11 colours would vanish on every resize.
      val term = session.getEmulator() ?: return
      if (term !== themedEmulator) {
        themedEmulator = term
        term.mColors.reset()
        terminal.invalidate()
      }
    }
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
  }

  val terminal: HostedTerminalView = HostedTerminalView(context).also { view ->
    view.setTerminalViewClient(client)
    view.setTextSize((fontDp * density).roundToInt())
    view.setTypeface(monoTypeface)
    view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    addView(view)
  }

  init {
    terminal.attachSession(session)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    terminal.layout(0, 0, r - l, b - t)
  }

  // ─── props ───────────────────────────────────────────────────────────────

  fun setFontSizeDp(dp: Float) {
    if (dp <= 0f || dp == fontDp) return
    fontDp = dp
    lastGrid = null // the cell size changed even where the grid did not; report it
    terminal.setTextSize((dp * density).roundToInt())
    session.getEmulator()?.let { reportSize(it.mColumns, it.mRows) }
    terminal.invalidate()
  }

  /**
   * The desktop's palette for this tab. It goes on Termux's static scheme so the emulator's own
   * resets (RIS, which every host snapshot is prefixed with) land on it instead of Termux's
   * defaults, and the live colours are reset to it here so the change shows now. The scheme is
   * one per process, so two panes with different palettes would share the last one written;
   * the palette is the desktop's light or dark theme, the same for every tab, so they do not.
   */
  fun setTheme(theme: Map<String, Any?>?) {
    if (theme == null) return
    // Only #rrggbb reaches the scheme: updateWith resets it to Termux's defaults first and throws
    // on the first value it cannot parse, which would leave a half-default scheme behind. The
    // JS side normalises CSS colours to this form and drops what it cannot; this is the last check.
    val props = Properties()
    fun put(key: String, value: Any?) {
      if (value is String && HEX_RGB.matches(value)) props[key] = value
      else if (value != null) Log.w(TAG, "theme colour $key dropped: $value")
    }
    put("foreground", theme["foreground"])
    put("background", theme["background"])
    put("cursor", theme["cursorColor"])
    (theme["palette"] as? List<*>)?.forEachIndexed { index, value ->
      if (index < 16) put("color$index", value)
    }
    TerminalColors.COLOR_SCHEME.updateWith(props)
    session.getEmulator()?.mColors?.reset()
    (props["background"] as? String)?.let { terminal.setBackgroundColor(android.graphics.Color.parseColor(it)) }
    terminal.invalidate()
  }

  // ─── commands ────────────────────────────────────────────────────────────

  /**
   * Bytes from the desktop, as the JS string the relay hands the app. Expo runs a view command on
   * the main queue, and the append stays inside this call on purpose: whatever the chunk makes
   * the emulator answer (cursor position, device attributes) is flushed and on its way to JS
   * before the command's promise settles, which is what the JS replay guard is scoped to. It
   * was posted once, and a replayed snapshot's answers reached the desktop composer as typed
   * text, the 2026-09-13 bug back again. Anything a gesture left pending leaves first, on its own.
   */
  fun writeText(text: String) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    session.flushOutput()
    session.append(bytes, bytes.size)
    session.flushOutput()
  }

  fun cancelSelect() {
    if (terminal.isSelectingText) terminal.stopTextSelectionMode()
  }

  // ─── reports ─────────────────────────────────────────────────────────────

  private fun screenChanged() {
    // Termux snaps the viewport to the bottom on every chunk unless auto-scroll is off, a flag
    // its own app toggles from an extra key. Here it follows the finger: reading scrollback
    // while output streams keeps the rows under the eye, the way xterm and libghostty did, and
    // scrolling back to the bottom releases it.
    session.getEmulator()?.let { term ->
      val reading = terminal.topRow < 0
      if (term.isAutoScrollDisabled != reading) term.toggleAutoScrollDisabled()
    }
    terminal.onScreenUpdated()
    reportModes()
    reportMetrics()
  }

  /** The grid, with the cell size in dp: the app widens the view to a host's column count
   *  from it (cols × cellWidth + one pixel, since the grid floors) instead of shrinking the font. */
  private fun reportSize(columns: Int, rows: Int) {
    val grid = columns to rows
    if (grid == lastGrid) return
    lastGrid = grid
    onResize(
      mapOf(
        "cols" to columns,
        "rows" to rows,
        "cellWidth" to TerminalViewCells.cellWidth(terminal) / density,
        "cellHeight" to TerminalViewCells.cellHeight(terminal) / density
      )
    )
  }

  private fun reportModes() {
    val term = session.getEmulator() ?: return
    val mouse = when {
      !term.isMouseTrackingActive -> "none"
      term.isMouseAnyEventTrackingActive -> "any"
      term.isMouseButtonEventTrackingActive -> "drag"
      else -> "vt200"
    }
    val next = listOf(term.isAlternateBufferActive, mouse, term.isSgrMouseProtocolActive, term.isBracketedPasteModeActive)
    if (next == lastModes) return
    lastModes = next
    onModes(
      mapOf(
        "altScreen" to term.isAlternateBufferActive,
        "mouseTrackingMode" to mouse,
        "sgrMouseMode" to term.isSgrMouseProtocolActive,
        "bracketedPasteMode" to term.isBracketedPasteModeActive
      )
    )
  }

  /** Where the caret and the last drawn row are, for the app's keyboard avoidance. */
  private fun reportMetrics() {
    val term = session.getEmulator() ?: return
    val alt = term.isAlternateBufferActive
    val bottom = if (alt) 0 else maxOf(0, TerminalViewCells.lastPrintingRow(term))
    val next = listOf(term.cursorRow, bottom, term.mRows, alt)
    if (next == lastMetrics) return
    lastMetrics = next
    onMetrics(mapOf("cursorY" to term.cursorRow, "contentBottomRow" to bottom, "rows" to term.mRows, "altScreen" to alt))
  }

  companion object {
    private const val TAG = "TermuxTerminalView"
    private val HEX_RGB = Regex("^#[0-9a-fA-F]{6}$")

    /** Glyph fallbacks behind the system mono face, in order; Termux's renderer takes one
     *  Typeface. The Nerd symbols font (private-use: powerline, devicons) is the Ghostty
     *  engine's, minus its U+276C..2771 angle brackets so the prompt's `❯` keeps the system
     *  glyph it had. The Noto subset is U+23F4..23FA only: Claude Code's status line writes
     *  `⏵⏵` (U+23F5), which no font on a Galaxy S23 carries, and it drew as boxes
     *  (2026-09-21). Custom fallbacks are consulted before the system chain, so each file
     *  holds only glyphs the system lacks or draws wrongly. */
    private val FALLBACK_FONT_ASSETS = listOf(
      "fonts/NotoSansSymbols2-MediaControls.ttf",
      "fonts/SymbolsNerdFontMono-Regular.ttf"
    )

    private fun monoWithSymbols(context: Context): Typeface {
      val monoPath = SYSTEM_MONO_FONT_FILES.firstOrNull { File(it).isFile }
      if (monoPath == null) {
        Log.w(TAG, "no system monospace file found; falling back to Typeface.MONOSPACE, which an OEM may substitute")
        return Typeface.MONOSPACE
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        runCatching {
          val builder = Typeface.CustomFallbackBuilder(FontFamily.Builder(Font.Builder(File(monoPath)).build()).build())
          for (asset in FALLBACK_FONT_ASSETS) {
            builder.addCustomFallback(FontFamily.Builder(Font.Builder(context.assets, asset).build()).build())
          }
          return builder.build()
        }.onFailure { Log.w(TAG, "symbols fallback unavailable: ${it.message}") }
      }
      return runCatching { Typeface.createFromFile(monoPath) }.getOrElse { Typeface.MONOSPACE }
    }
  }
}
